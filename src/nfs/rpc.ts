import {Mutex} from 'async-mutex';
import promiseRetry from 'promise-retry';
import {TimeoutError} from 'promise-timeout';
import type {OperationOptions} from 'retry';

import type {Socket} from 'node:dgram';
import dgram from 'node:dgram';

import {udpClose, udpSend} from 'src/utils/udp';

import {rpc} from './xdr';

/**
 * The RPC auth stamp passed by the CDJs. It's unclear if this is actually
 * important, but I'm keeping the rpc calls as close to CDJ calls as I can.
 */
const CDJ_AUTH_STAMP = 0x967b8703;

const rpcAuthMessage = new rpc.UnixAuth({
  stamp: CDJ_AUTH_STAMP,
  name: '',
  uid: 0,
  gid: 0,
  gids: [],
});

interface RpcCall {
  port: number;
  program: number;
  version: number;
  procedure: number;
  data: Buffer;
}

/**
 * Configuration for the retry strategy to use when making RPC calls
 *
 * @see https://www.npmjs.com/package/promise-retry#promiseretryfn-options
 */
export type RetryConfig = OperationOptions & {
  /**
   * Time in milliseconds to wait before a RPC transaction should timeout.
   * @default 1000
   */
  transactionTimeout?: number;
};

/**
 * Generic RPC connection. Can be used to make RPC 2 calls to any program
 * specified in the RpcCall.
 */
export class RpcConnection {
  address: string;
  retryConfig: RetryConfig;
  socket: Socket;
  mutex: Mutex;
  xid = 1;

  constructor(address: string, retryConfig?: RetryConfig) {
    this.address = address;
    this.retryConfig = retryConfig ?? {};
    this.socket = dgram.createSocket('udp4');
    this.mutex = new Mutex();
  }

  // TODO: Turn this into a getter and figure out what logic we can do here
  // to determine if the socket is still open.
  connected = true;

  setupRequest({program, version, procedure, data}: Omit<RpcCall, 'port'>, xid: number) {
    const auth = new rpc.Auth({
      flavor: 1,
      body: rpcAuthMessage.toXDR(),
    });

    const verifier = new rpc.Auth({
      flavor: 0,
      body: Buffer.alloc(0),
    });

    const request = new rpc.Request({
      rpcVersion: rpc.Version,
      programVersion: version,
      program,
      procedure,
      auth,
      verifier,
      data,
    });

    const packet = new rpc.Packet({
      xid,
      message: rpc.Message.request(request),
    });

    return packet.toXDR();
  }

  /**
   * Wait for a UDP datagram whose RPC xid matches `xid`, rejecting with a
   * TimeoutError after `timeoutMs`.
   *
   * The xid is the leading 4 bytes of every RPC reply (see the `Packet`
   * XDR struct - `xid` is a leading uint). Matching on it is what lets a
   * late reply to a previous, already-timed-out transaction be ignored
   * instead of being mis-attributed to the call currently waiting. Without
   * this, a single dropped packet on a lossy link desynced responses from
   * requests and surfaced as "RPC did not successfully return data" or
   * garbled metadata. Both the listener and the timer are always torn down
   * on the way out, so a retry can never leak a `message` handler onto the
   * shared socket.
   */
  private readResponse(xid: number, timeoutMs: number): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.off('message', onMessage);
        this.socket.off('error', onError);
      };
      const onMessage = (msg: Buffer) => {
        // Ignore datagrams too short to carry an xid, and replies belonging
        // to a different transaction - keep listening for ours.
        if (msg.length >= 4 && msg.readUInt32BE(0) === xid) {
          cleanup();
          resolve(msg);
        }
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new TimeoutError());
      }, timeoutMs);
      this.socket.on('message', onMessage);
      this.socket.once('error', onError);
    });
  }

  /**
   * Execute a RPC transaction (call and response).
   *
   * If a transaction does not complete after the configured timeout it will be
   * retried with the retry configuration.
   */
  async call({port, ...call}: RpcCall) {
    // Each transaction gets a fresh 32-bit xid (wrapping) so readResponse
    // can tell our reply apart from a stale one. Allocated before any await.
    const xid = this.xid;
    this.xid = this.xid >= 0xffffffff ? 1 : this.xid + 1;

    const callData = this.setupRequest(call, xid);

    const {transactionTimeout, ...retryConfig} = this.retryConfig;
    const timeoutMs = transactionTimeout ?? 1000;

    // One transaction attempt: (re)send the identical request and wait for
    // the matching reply. Retransmitting with the same xid is correct RPC
    // behavior - if the original reply was merely slow it still matches.
    const executeCall = async () => {
      await udpSend(this.socket, callData, 0, callData.length, port, this.address);
      return this.readResponse(xid, timeoutMs);
    };

    // Function to execute the transaction, with retries if it times out.
    const executeWithRetry = () =>
      promiseRetry(retryConfig, async retry => {
        try {
          return await executeCall();
        } catch (err) {
          if (err instanceof TimeoutError) {
            retry(err);
          } else {
            throw err;
          }
        }
      });

    // Execute the transaction exclusively to avoid async call races
    const resp = await this.mutex.runExclusive(executeWithRetry);

    // Decode the XDR response
    const packet = rpc.Packet.fromXDR(resp);

    const message = packet.message().response();
    if (message.arm() !== 'accepted') {
      throw new Error('RPC request was denied');
    }

    const body = message.accepted().response();
    if (body.arm() !== 'success') {
      throw new Error('RPC did not successfully return data');
    }

    return body.success() as Buffer;
  }

  async disconnect() {
    await udpClose(this.socket);
  }
}

type RpcProgramCall = Pick<RpcCall, 'procedure' | 'data'>;

/**
 * RpcProgram is constructed with specialization details for a specific RPC
 * program. This should be used to avoid having to repeat yourself for calls
 * made using the RpcConnection.
 */
export class RpcProgram {
  program: number;
  version: number;
  port: number;
  conn: RpcConnection;

  constructor(conn: RpcConnection, program: number, version: number, port: number) {
    this.conn = conn;
    this.program = program;
    this.version = version;
    this.port = port;
  }

  call(data: RpcProgramCall) {
    const {program, version, port} = this;
    return this.conn.call({program, version, port, ...data});
  }

  disconnect() {
    this.conn.disconnect();
  }
}
