import type {Span} from '@sentry/tracing';
import {timeout} from 'promise-timeout';

import type LocalDatabase from 'src/localdb';
import {loadAnlz} from 'src/localdb/rekordbox';
import type RemoteDatabase from 'src/remotedb';
import {MenuTarget, Query} from 'src/remotedb';
import type {Device, DeviceID, TrackType} from 'src/types';
import {MediaSlot} from 'src/types';

import {anlzLoader} from './utils';

export interface Options {
  /**
   * The device to query the track metadata from
   */
  deviceId: DeviceID;
  /**
   * The media slot the track is present in
   */
  trackSlot: MediaSlot;
  /**
   * The type of track we are querying for
   */
  trackType: TrackType;
  /**
   * The track id to retrieve metadata for
   */
  trackId: number;
  /**
   * The Sentry transaction span
   */
  span?: Span;
}

export async function viaRemote(remote: RemoteDatabase, opts: Required<Options>) {
  const {deviceId, trackSlot, trackType, trackId, span} = opts;

  const conn = await remote.get(deviceId);
  if (conn === null) {
    return null;
  }

  const queryDescriptor = {
    trackSlot,
    trackType,
    menuTarget: MenuTarget.Main,
  };

  const isUnanalyzed = trackType === TrackType.Unanalyzed || trackType === TrackType.AudioCD;

  // Unanalyzed tracks use GetGenericMetadata (reads ID3 tags from the audio file)
  const track = await conn.query({
    queryDescriptor,
    query: isUnanalyzed ? Query.GetGenericMetadata : Query.GetMetadata,
    args: {trackId},
    span,
  });

  // Try to get file path (may not be available for unanalyzed tracks)
  try {
    track.filePath = await conn.query({
      queryDescriptor,
      query: Query.GetTrackInfo,
      args: {trackId},
      span,
    });
  } catch (err) {
    if (!isUnanalyzed) throw err;
    // Expected for unanalyzed tracks — no file path available
  }

  // Beat grid is only available for analyzed tracks
  if (!isUnanalyzed) {
    track.beatGrid = await conn.query({
      queryDescriptor,
      query: Query.GetBeatGrid,
      args: {trackId},
      span,
    });
  }

  return track;
}

export async function viaLocal(
  local: LocalDatabase,
  device: Device,
  opts: Required<Options>,
) {
  const {deviceId, trackSlot, trackId} = opts;

  if (trackSlot !== MediaSlot.USB && trackSlot !== MediaSlot.SD) {
    throw new Error('Expected USB or SD slot for local database query');
  }

  const orm = await local.get(deviceId, trackSlot);
  if (orm === null) {
    return null;
  }

  const track = orm.findTrack(trackId);

  if (track === null) {
    return null;
  }

  // The SQLite row from the hydrated database already carries everything most
  // callers need (title, artist, album, genre, key, tempo, ...). beatGrid and
  // cueAndLoops come from a SEPARATE per-track NFS fetch of the `.DAT` analyze
  // file, which can hang or fail independently of the (already-loaded)
  // database - a single stuck file read here would otherwise block the entire
  // metadata lookup and, upstream, get the play dropped. Treat the ANLZ load
  // as best-effort with a hard timeout: return the database metadata with no
  // beat grid / cues rather than failing the whole lookup.
  try {
    const anlz = await timeout(
      loadAnlz(track, 'DAT', anlzLoader({device, slot: trackSlot})),
      ANLZ_LOAD_TIMEOUT_MS,
    );
    track.beatGrid = anlz.beatGrid;
    track.cueAndLoops = anlz.cueAndLoops;
  } catch {
    // ANLZ unavailable (NFS slow/down, file missing, or parse error). The
    // background fetch, if still running, resolves harmlessly and is ignored.
  }

  return track;
}

/**
 * Hard cap on the per-track ANLZ (`.DAT`) NFS fetch in {@link viaLocal}. The
 * beat grid / cues it yields are non-essential next to the database row, so we
 * never let a slow or wedged analyze-file read hold up a metadata lookup.
 */
const ANLZ_LOAD_TIMEOUT_MS = 5000;
