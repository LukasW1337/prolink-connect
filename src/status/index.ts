import {Mutex} from 'async-mutex';
import type StrictEventEmitter from 'strict-event-emitter-types';

import type {Socket} from 'node:dgram';
import {EventEmitter} from 'node:events';

import {STATUS_PORT} from 'src/constants';
import type {CDJStatus, DeviceID, MediaSlot, MediaSlotInfo} from 'src/types';
import {udpSend} from 'src/utils/udp';

import {makeMediaSlotRequest} from './media';
import {mediaSlotFromPacket, statusFromPacket} from './utils';

/**
 * How long to wait for a CDJ to answer a media-slot query before giving up.
 * Media-slot replies normally arrive in well under a second; this is a
 * generous ceiling that exists purely so a non-answering slot can't wedge
 * the query lock (see queryMediaSlot).
 */
const MEDIA_SLOT_QUERY_TIMEOUT_MS = 4000;

/**
 * Thrown by {@link StatusEmitter.queryMediaSlot} when a device doesn't reply
 * to a media-slot query within {@link MEDIA_SLOT_QUERY_TIMEOUT_MS}. Callers
 * (e.g. LocalDatabase.get) should treat this as "couldn't determine media"
 * and degrade gracefully rather than hang.
 */
export class MediaSlotQueryTimeoutError extends Error {
  constructor(deviceId: DeviceID, slot: MediaSlot) {
    super(`Timed out querying media slot ${slot} on device ${deviceId}`);
    this.name = 'MediaSlotQueryTimeoutError';
  }
}

interface StatusEvents {
  /**
   * Fired each time the CDJ reports its status
   */
  status: (status: CDJStatus.State) => void;
  /**
   * Fired when the CDJ reports its media slot status
   */
  mediaSlot: (info: MediaSlotInfo) => void;
}

type Emitter = StrictEventEmitter<EventEmitter, StatusEvents>;

type MediaSlotOptions = Parameters<typeof makeMediaSlotRequest>[0];

/**
 * The status emitter will report every time a device status is received
 */
class StatusEmitter {
  #statusSocket: Socket;
  /**
   * The EventEmitter which reports the device status
   */
  #emitter: Emitter = new EventEmitter();
  /**
   * Lock used to avoid media slot query races
   */
  #mediaSlotQueryLock = new Mutex();

  /**
   * @param statusSocket A UDP socket to receive CDJ status packets on
   */
  constructor(statusSocket: Socket) {
    this.#statusSocket = statusSocket;
    statusSocket.on('message', this.#handleStatus);
  }

  // Bind public event emitter interface
  on: Emitter['on'] = this.#emitter.addListener.bind(this.#emitter);
  off: Emitter['off'] = this.#emitter.removeListener.bind(this.#emitter);
  once: Emitter['once'] = this.#emitter.once.bind(this.#emitter);

  #handleStatus = (message: Buffer) => {
    const status = statusFromPacket(message);

    if (status !== undefined) {
      return this.#emitter.emit('status', status);
    }

    // Media slot status is also reported on this socket
    const mediaSlot = mediaSlotFromPacket(message);

    if (mediaSlot !== undefined) {
      this.#emitter.emit('mediaSlot', mediaSlot);
    }
  };

  /**
   * Retrieve media slot status information.
   *
   * Rejects with a {@link MediaSlotQueryTimeoutError} if the device doesn't
   * answer within {@link MEDIA_SLOT_QUERY_TIMEOUT_MS}. The timeout is critical:
   * the wait holds #mediaSlotQueryLock, and this is called on the hot path of
   * every LocalDatabase.get (i.e. every metadata lookup). Without a bound, a
   * single slot that never replies - an empty SD slot, a CD, a busy player,
   * a dropped packet - would hang forever AND wedge the lock, silently
   * poisoning *all* subsequent media queries and metadata lookups. We also
   * match the reply to the requested device+slot, since every CDJ's periodic
   * media broadcasts land on this same socket and would otherwise resolve the
   * wrong query.
   */
  async queryMediaSlot(options: MediaSlotOptions) {
    const request = makeMediaSlotRequest(options);

    return this.#mediaSlotQueryLock.runExclusive(
      () =>
        new Promise<MediaSlotInfo>((resolve, reject) => {
          const onSlot = (info: MediaSlotInfo) => {
            // Ignore replies for a different device/slot; keep listening for
            // the one we asked about.
            if (
              info.deviceId !== options.device.id ||
              info.slot !== options.slot
            ) {
              return;
            }
            cleanup();
            resolve(info);
          };

          const timer = setTimeout(() => {
            cleanup();
            reject(new MediaSlotQueryTimeoutError(options.device.id, options.slot));
          }, MEDIA_SLOT_QUERY_TIMEOUT_MS);

          const cleanup = () => {
            clearTimeout(timer);
            this.off('mediaSlot', onSlot);
          };

          this.on('mediaSlot', onSlot);

          udpSend(
            this.#statusSocket,
            request,
            STATUS_PORT,
            options.device.ip.address,
          ).catch(err => {
            cleanup();
            reject(err as Error);
          });
        }),
    );
  }
}

export default StatusEmitter;
