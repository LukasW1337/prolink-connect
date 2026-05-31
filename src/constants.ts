/**
 * The default virtual CDJ ID to use.
 *
 * This particular ID is out of the 1-6 range, thus will not be able to request
 * metadata via the remotedb for CDJs.
 */
export const DEFAULT_VCDJ_ID = 0x07;

/**
 * The number a real NXS-GW / CDJ-3000 embedded gateway uses. Critical: a
 * CDJ-3000 only streams its status (0x0a) to a monitor whose number is ABOVE
 * this. At or below it, the deck ignores us for status (confirmed on hardware:
 * 0x13 got the media handshake but no status; numbers > 0x19 stream).
 */
export const KUVO_DEFAULT_NUMBER = 0x19;

/**
 * Device-number range for our KUVO virtual device. Both bounds matter,
 * empirically:
 *  - MIN must be ABOVE the gateway number (0x19) or decks won't stream status.
 *  - staying well under ~0x32 keeps the deck emitting the compact ~292-byte
 *    status; higher numbers flip it into the verbose ~1100-byte status (more
 *    traffic for no gain). 0x1a..0x27 sits safely in the compact, above-gateway
 *    band and never consumes a 1-6 player slot.
 */
export const MONITOR_NUMBER_MIN = 0x1a; // 26 - one above the gateway
export const MONITOR_NUMBER_MAX = 0x27; // 39 - below the verbose-status threshold

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
 * Name announced when posing as a KUVO gateway. The name is cosmetic - decks
 * key their behaviour off the device TYPE and NUMBER, not the name - so we use
 * our own identifiable name. (Our announce echo is filtered from the roster by
 * address, not name, so this is safe even next to a real NXS-GW.)
 */
export const VIRTUAL_KUVO_NAME = 'mt-tracker';

/**
 * VirtualCDJFirmware is a string indicating the firmware version reported with
 * status packets.
 */
export const VIRTUAL_CDJ_FIRMWARE = '1.43';
