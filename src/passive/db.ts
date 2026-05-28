/**
 * PassiveDatabase mirrors the active Database surface (getMetadata,
 * getWaveforms, getFile, cdjSupportsRemotedb) on top of the passive
 * localdb + remotedb pair, so existing consumers that rely on the
 * `network.db` accessor keep working when bringOnlinePassive() is used
 * instead of bringOnline().
 *
 * The routing logic mirrors active Database.#getTrackLookupStrategy:
 *   - Rekordbox-laptop devices (DeviceType.Rekordbox) -> remotedb
 *   - CDJ + unanalyzed / AudioCD tracks                -> remotedb
 *   - CDJ + analyzed (TrackType.RB)                    -> localdb (NFS .pdb)
 *
 * Waveforms / analyze-file fetches use the same loadAnlz pattern as the
 * active path - the passive localdb returns a hydrated MetadataORM with
 * the same shape, so the only difference is which DeviceManager flavor
 * is doing the resolution.
 */

import {timeout} from 'promise-timeout';

import {loadAnlz} from 'src/localdb/rekordbox';
import {fetchFile, FetchProgress} from 'src/nfs';
import {Device, DeviceID, DeviceType, MediaSlot, TrackType, Waveforms} from 'src/types';
import * as Telemetry from 'src/utils/telemetry';

import {anlzLoaderForPassive} from './anlz-loader';
import {PassiveDeviceManager} from './devices';
import {PassiveLocalDatabase} from './localdb';
import {PassiveRemoteDatabase} from './remotedb';

/**
 * Hard cap on the per-track ANLZ (.DAT) NFS fetch. The beat grid / cues
 * it yields are non-essential next to the database row, so we never let
 * a slow or wedged analyze-file read hold up a metadata lookup. Matches
 * the active Database's behaviour.
 */
const ANLZ_LOAD_TIMEOUT_MS = 5000;

enum LookupStrategy {
  Local,
  Remote,
  NoneAvailable,
}

export interface GetMetadataOptions {
  deviceId: DeviceID;
  trackSlot: MediaSlot;
  trackType: TrackType;
  trackId: number;
  span?: unknown;
}

export interface GetWaveformsOptions extends GetMetadataOptions {}

export interface GetFileOptions {
  device: Device;
  slot: MediaSlot;
  path: string;
  span?: unknown;
  onProgress?: (progress: FetchProgress) => void;
}

/**
 * Routing strategy for a (device, trackType) pair. Mirrors active.
 */
function getTrackLookupStrategy(device: Device, trackType: TrackType): LookupStrategy {
  const isUnanalyzed =
    trackType === TrackType.AudioCD || trackType === TrackType.Unanalyzed;

  if (device.type === DeviceType.Rekordbox) {
    return LookupStrategy.Remote;
  }
  if (device.type === DeviceType.CDJ && isUnanalyzed) {
    return LookupStrategy.Remote;
  }
  if (device.type === DeviceType.CDJ && trackType === TrackType.RB) {
    return LookupStrategy.Local;
  }
  return LookupStrategy.NoneAvailable;
}

export class PassiveDatabase {
  #deviceManager: PassiveDeviceManager;
  #localdb: PassiveLocalDatabase;
  #remotedb: PassiveRemoteDatabase;

  constructor(
    deviceManager: PassiveDeviceManager,
    localdb: PassiveLocalDatabase,
    remotedb: PassiveRemoteDatabase
  ) {
    this.#deviceManager = deviceManager;
    this.#localdb = localdb;
    this.#remotedb = remotedb;
  }

  /**
   * Active mode gates remotedb-for-CDJ on the vCDJ holding an id in 1-6,
   * since CDJs refuse metadata queries from out-of-range ids. The passive
   * remotedb uses its own configurable virtualDeviceId (default 5), which
   * is in the supported range, so passive always supports the remotedb
   * path.
   */
  get cdjSupportsRemotedb(): boolean {
    return true;
  }

  async getMetadata(opts: GetMetadataOptions) {
    const {deviceId, trackSlot, trackType, trackId} = opts;

    const device = this.#deviceManager.devices.get(deviceId);
    if (!device) {
      return null;
    }

    const strategy = getTrackLookupStrategy(device, trackType);

    if (strategy === LookupStrategy.Remote) {
      try {
        if (trackType === TrackType.Unanalyzed || trackType === TrackType.AudioCD) {
          return await this.#remotedb.getGenericTrackMetadata(
            deviceId,
            trackSlot,
            trackType,
            trackId
          );
        }
        return await this.#remotedb.getTrackMetadata(
          deviceId,
          trackSlot,
          trackType,
          trackId
        );
      } catch {
        return null;
      }
    }

    if (strategy === LookupStrategy.Local) {
      if (trackSlot !== MediaSlot.USB && trackSlot !== MediaSlot.SD) {
        return null;
      }

      const orm = await this.#localdb.get(deviceId, trackSlot);
      if (orm === null) {
        return null;
      }

      const track = orm.findTrack(trackId);
      if (track === null || track === undefined) {
        return null;
      }

      // Best-effort enrichment with beatGrid + cueAndLoops from the .DAT
      // analyze file. Same hard-cap as active mode: if NFS hangs we ship
      // metadata without beats rather than failing the whole lookup.
      try {
        const anlz = await timeout(
          loadAnlz(track, 'DAT', anlzLoaderForPassive({device, slot: trackSlot})),
          ANLZ_LOAD_TIMEOUT_MS
        );
        track.beatGrid = anlz.beatGrid;
        track.cueAndLoops = anlz.cueAndLoops;
      } catch {
        // ANLZ unavailable; database row still has the essentials.
      }

      return track;
    }

    return null;
  }

  async getWaveforms(opts: GetWaveformsOptions): Promise<Waveforms | null> {
    const {deviceId, trackSlot, trackType, trackId} = opts;

    const device = this.#deviceManager.devices.get(deviceId);
    if (!device) {
      return null;
    }

    const strategy = getTrackLookupStrategy(device, trackType);

    if (strategy === LookupStrategy.Local) {
      if (trackSlot !== MediaSlot.USB && trackSlot !== MediaSlot.SD) {
        return null;
      }

      const orm = await this.#localdb.get(deviceId, trackSlot);
      if (orm === null) {
        return null;
      }

      const track = orm.findTrack(trackId);
      if (track === null || track === undefined) {
        return null;
      }

      try {
        const anlz = await loadAnlz(
          track,
          'EXT',
          anlzLoaderForPassive({device, slot: trackSlot})
        );
        return {
          waveformHd: anlz.waveformHd,
          waveformColorPreview: anlz.waveformColorPreview ?? null,
        } as Waveforms;
      } catch {
        return null;
      }
    }

    // Remote waveform path requires the active vCDJ for the remotedb
    // GetWaveformHD query; passive doesn't replicate it. Skip for now.
    return null;
  }

  async getFile(opts: GetFileOptions): Promise<Buffer> {
    const {device, slot, path, onProgress} = opts;
    return fetchFile({
      device,
      slot: slot as MediaSlot.USB | MediaSlot.SD,
      path,
      span: Telemetry.startTransaction({name: 'passiveGetFile'}),
      onProgress,
    });
  }
}
