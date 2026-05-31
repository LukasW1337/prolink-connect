/**
 * The default virtual CDJ ID to use.
 *
 * This particular ID is out of the 1-6 range, thus will not be able to request
 * metadata via the remotedb for CDJs.
 */
export const DEFAULT_VCDJ_ID = 0x07;

/**
 * Device-number range Pioneer uses for non-player / monitor devices (rekordbox,
 * lighting, KUVO gateway). A KUVO virtual device self-assigns from here so it
 * never consumes a 1-6 player slot.
 */
export const MONITOR_NUMBER_MIN = 0x13;
export const MONITOR_NUMBER_MAX = 0x27;

/**
 * The number a real NXS-GW/KUVO self-assigns. We prefer it when free, but a
 * CDJ-3000 embeds the gateway role at this number, so the picker falls back to
 * another free monitor number when it's taken.
 */
export const KUVO_DEFAULT_NUMBER = 0x19;

/**
 * The port on which devices on the prolink network announce themselves.
 */
export const ANNOUNCE_PORT = 50000;

/**
 * The port on which devices on the prolink network send beat timing information.
 */
export const BEAT_PORT = 50001;

/**
 * The port on which devices on the prolink network announce themselves.
 */
export const STATUS_PORT = 50002;

/**
 * The amount of time in ms between sending each announcement packet.
 */
export const ANNOUNCE_INTERVAL = 1500;

// oxfmt-ignore
/**
 * All UDP packets on the PRO DJ LINK network start with this magic header.
 */
export const PROLINK_HEADER = Uint8Array.of(
  0x51, 0x73, 0x70, 0x74, 0x31,
  0x57, 0x6d, 0x4a, 0x4f, 0x4c
);

/**
 * VirtualCDJName is the name given to the Virtual CDJ device.
 */
export const VIRTUAL_CDJ_NAME = 'prolink-typescript';

/**
 * Name announced when posing as a KUVO gateway: the real product name, so we
 * register on the network exactly like an NXS-GW. (Our own announce echo is
 * filtered from the roster by address, not name, so this is safe.)
 */
export const VIRTUAL_KUVO_NAME = 'NXS-GW';

/**
 * VirtualCDJFirmware is a string indicating the firmware version reported with
 * status packets.
 */
export const VIRTUAL_CDJ_FIRMWARE = '1.43';
