import * as ip from 'ip-address';

import type {Socket} from 'node:dgram';
import type {NetworkInterfaceInfoIPv4} from 'node:os';

import {
  ANNOUNCE_INTERVAL,
  ANNOUNCE_PORT,
  MONITOR_NUMBER_MAX,
  MONITOR_NUMBER_MIN,
  PROLINK_HEADER,
  VIRTUAL_CDJ_FIRMWARE,
  VIRTUAL_CDJ_NAME,
  VIRTUAL_KUVO_NAME,
} from 'src/constants';
import type DeviceManager from 'src/devices';
import type {Device, DeviceID} from 'src/types';
import {DeviceType} from 'src/types';
import {buildName} from 'src/utils';

/**
 * Constructs the virtual device we announce as. Defaults to the KUVO (NXS-GW
 * gateway) class: a passive monitor that wakes decks via presence without
 * claiming a player slot or advertising a library. Pass a different `type` /
 * `name` to override (e.g. announce as a CDJ for remotedb metadata access).
 */
export const getVirtualCDJ = (
  iface: NetworkInterfaceInfoIPv4,
  id: DeviceID,
  type: DeviceType = DeviceType.KUVO,
  name?: string,
): Device => ({
  id,
  // Default the name to match the identity: a KUVO announces as "NXS-GW", any
  // other pose uses the library's default name.
  name: name ?? (type === DeviceType.KUVO ? VIRTUAL_KUVO_NAME : VIRTUAL_CDJ_NAME),
  type,
  ip: new ip.Address4(iface.address),
  macAddr: new Uint8Array(iface.mac.split(':').map(s => Number.parseInt(s, 16))),
});

/**
 * Pick a device number in the monitor range (MONITOR_NUMBER_MIN..MAX) that no
 * device we've heard from is using.
 *
 * The range itself encodes the hard-won constraint: it starts ABOVE the gateway
 * number (0x19) because a CDJ-3000 only streams status to a monitor numbered
 * above its own embedded gateway - at/below it (e.g. 0x13) the deck recognises
 * us but won't stream status - and stays in the low end of that band to keep
 * the status compact. So any free slot in the range is a valid streaming
 * number; honor an explicit free `preferred` first, else take the first free.
 */
export function chooseMonitorNumber(used: Set<DeviceID>, preferred?: number): DeviceID {
  if (
    preferred !== undefined &&
    preferred >= MONITOR_NUMBER_MIN &&
    preferred <= MONITOR_NUMBER_MAX &&
    !used.has(preferred)
  ) {
    return preferred;
  }
  // The range already starts above the gateway number, so any free slot here is
  // a valid status-streaming number.
  for (let n = MONITOR_NUMBER_MIN; n <= MONITOR_NUMBER_MAX; n++) {
    if (!used.has(n)) return n;
  }
  return MONITOR_NUMBER_MIN; // range exhausted; least-bad, still above the gateway
}

/**
 * Returns a mostly empty-state status packet. This is currently used to report
 * the virtual CDJs status, which *seems* to be required for the CDJ to send
 * metadata about some unanalyzed mp3 files.
 */
export function makeStatusPacket(device: Device): Uint8Array {
  // NOTE: It seems that byte 0x68 and 0x75 MUST be 1 in order for the CDJ to
  //       correctly report mp3 metadata (again, only for some files).
  //       See https://github.com/brunchboy/dysentery/issues/15
  // NOTE: Byte 0xb6 MUST be 1 in order for the CDJ to not think that our
  //       device is "running an older firmware"
  //
  // oxfmt-ignore
  const b = new Uint8Array([
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0x03, 0x00, 0x00, 0xf8, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x04, 0x04, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9c, 0xff, 0xfe, 0x00, 0x10, 0x00, 0x00,
    0x7f, 0xff, 0xff, 0xff, 0x7f, 0xff, 0xff, 0xff, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
    0xff, 0xff, 0xff, 0xff, 0x01, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x10, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);

  // The following items get replaced in this format:
  //
  //  - 0x00: 10 byte header
  //  - 0x0B: 20 byte device name
  //  - 0x21: 01 byte device ID
  //  - 0x24: 01 byte device ID
  //  - 0x7C: 04 byte firmware string

  b.set(PROLINK_HEADER, 0x0b);
  // 20-byte name field (0x0b..0x1e); truncate so a long nickname can't run into
  // the device-ID byte at 0x21.
  b.set(Buffer.from(device.name, 'ascii').subarray(0, 20), 0x0b);
  b.set(new Uint8Array([device.id]), 0x21);
  b.set(new Uint8Array([device.id]), 0x24);
  b.set(Buffer.from(VIRTUAL_CDJ_FIRMWARE, 'ascii'), 0x7c);

  return b;
}

/**
 * constructs the announce packet that is sent on the prolink network to
 * announce a devices existence.
 */
export function makeAnnouncePacket(deviceToAnnounce: Device): Uint8Array {
  const d = deviceToAnnounce;

  // We announce a SELF-CONSISTENT keep-alive: 0x25 and 0x34 both carry the real
  // device type, and the two "unknown" fields always use the CDJ values
  // (0x21=02, 0x30=01). We keep type 0x08 (KUVO) and the above-gateway number -
  // the bits that actually wake CDJs - but emit them the consistent way.
  //
  // We USED to replay the real NXS-GW shape byte-for-byte for KUVO (0x21=01,
  // 0x25=02, 0x30=00 while 0x34=08) on the theory that strict Pioneer gear
  // wanted the faithful bytes. It does the opposite: a DJM reads the 0x25=02 /
  // 0x34=08 type contradiction as a malformed gateway and drops into an endless
  // reconnect loop (proven with kuvo-probe - the consistent shape survives, the
  // faithful one crashes the mixer).
  const unknown1 = [0x01, 0x02];
  const unknown2 = [0x01, 0x00, 0x00, 0x00];
  const typeAt25 = d.type;
  const typeAt34 = d.type;

  // The packet blow is constructed in the following format:
  //
  //  - 0x00: 10 byte header
  //  - 0x0A: 02 byte announce packet type
  //  - 0x0c: 20 byte device name
  //  - 0x20: 02 byte unknown
  //  - 0x22: 02 byte packet length
  //  - 0x24: 01 byte for the player ID
  //  - 0x25: 01 byte for the player type
  //  - 0x26: 06 byte mac address
  //  - 0x2C: 04 byte IP address
  //  - 0x30: 04 byte unknown
  //  - 0x34: 01 byte for the player type
  //  - 0x35: 01 byte final padding

  /* oxlint-disable no-useless-spread -- byte-protocol grouping */
  const parts = [
    ...PROLINK_HEADER,
    ...[0x06, 0x00],
    ...buildName(d),
    ...unknown1,
    ...[0x00, 0x36],
    ...[d.id],
    ...[typeAt25],
    ...d.macAddr,
    ...d.ip.toArray(),
    ...unknown2,
    ...[typeAt34],
    ...[0x00],
  ];
  /* oxlint-enable no-useless-spread */

  return Uint8Array.from(parts);
}

/**
 * the announcer service is used to report our fake CDJ to the prolink network,
 * as if it was a real CDJ.
 */
export class Announcer {
  /**
   * The announce socket to use to make the announcements
   */
  #announceSocket: Socket;
  /**
   * The device manager service used to determine which devices to announce
   * ourselves to.
   */
  #deviceManager: DeviceManager;
  /**
   * The virtual CDJ device to announce
   */
  #vcdj: Device;
  /**
   * The interval handle used to stop announcing
   */
  #intervalHandle?: NodeJS.Timeout;

  /**
   * The cached announce packet. Rebuilt whenever we yield to a new number.
   */
  #announcePacket: Uint8Array;
  /**
   * Subnet broadcast address we announce to (e.g. 169.254.255.255). Real
   * Pioneer devices BROADCAST their keep-alive; CDJs only treat us as present
   * (and stream status) when they see a broadcast announce, not a unicast one.
   */
  #broadcastAddress: string;

  constructor(
    vcdj: Device,
    announceSocket: Socket,
    deviceManager: DeviceManager,
    broadcastAddress = '255.255.255.255',
  ) {
    this.#vcdj = vcdj;
    this.#announceSocket = announceSocket;
    this.#deviceManager = deviceManager;
    this.#announcePacket = makeAnnouncePacket(vcdj);
    this.#broadcastAddress = broadcastAddress;
  }

  start() {
    // Watch for another device claiming our number so we can yield (below).
    this.#announceSocket.on('message', this.#handleConflict);

    // Broadcast our keep-alive to the whole segment, exactly like real gear.
    // Unicasting it to each known device (the old behaviour) does NOT make CDJs
    // start streaming status - the broadcast presence is what wakes them.
    const announce = () =>
      this.#announceSocket.send(this.#announcePacket, ANNOUNCE_PORT, this.#broadcastAddress);

    announce(); // don't wait a full interval to establish presence
    this.#intervalHandle = setInterval(announce, ANNOUNCE_INTERVAL);
  }

  stop() {
    if (this.#intervalHandle !== undefined) {
      clearInterval(this.#intervalHandle);
    }
    this.#announceSocket.off('message', this.#handleConflict);
  }

  /**
   * Yield our device number if another device claims it. As a passive KUVO
   * monitor we do NOT run the CDJ claim/defend handshake, so the correct
   * behaviour on a collision is to step aside: pick a new free monitor number
   * and rebuild our announce packet. Triggered by either a 0x08 conflict/defend
   * packet or a foreign 0x06 keep-alive carrying our number (both put the
   * contested number at 0x24).
   */
  #handleConflict = (msg: Buffer) => {
    const kind = msg[0x0a];
    if (kind !== 0x06 && kind !== 0x08) return;
    if (msg[0x24] !== this.#vcdj.id) return;

    // Ignore our own keep-alive echo (its payload carries our IP at 0x2c).
    if (kind === 0x06) {
      const ip = `${msg[0x2c]}.${msg[0x2d]}.${msg[0x2e]}.${msg[0x2f]}`;
      if (ip === this.#vcdj.ip.address) return;
    }

    const used = new Set<DeviceID>(
      [...this.#deviceManager.devices.values()].map(d => d.id),
    );
    used.add(this.#vcdj.id);
    const next = chooseMonitorNumber(used, this.#vcdj.id);
    if (next === this.#vcdj.id) return; // nothing else free; hold our ground

    const prev = this.#vcdj.id;
    this.#vcdj.id = next; // network holds this by reference, so queries follow
    this.#announcePacket = makeAnnouncePacket(this.#vcdj);
    // eslint-disable-next-line no-console
    console.log(
      `[prolink] device number 0x${prev.toString(16)} claimed by another device ` +
        `(${kind === 0x08 ? 'conflict/defend' : 'keep-alive'}); yielded to 0x${next.toString(16)}`,
    );
  };
}
