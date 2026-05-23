import * as Sentry from '@sentry/node';
import type {Span} from '@sentry/tracing';

import type {Track} from 'src/entities';
import type LocalDatabase from 'src/localdb';
import {fetchFile} from 'src/nfs';
import type RemoteDatabase from 'src/remotedb';
import {MenuTarget, Query} from 'src/remotedb';
import type {Device, DeviceID, TrackType} from 'src/types';
import {MediaSlot} from 'src/types';

export interface Options {
  /**
   * The device to query the track artwork off of
   */
  deviceId: DeviceID;
  /**
   * The media slot the track is present in
   */
  trackSlot: MediaSlot;
  /**
   * The type of track we are querying artwork for
   */
  trackType: TrackType;
  /**
   * The track to lookup artwork for
   */
  track: Track;
  /**
   * The Sentry transaction span
   */
  span?: Span;
}

export async function viaRemote(remote: RemoteDatabase, opts: Required<Options>) {
  const {deviceId, trackSlot, trackType, track, span} = opts;

  const conn = await remote.get(deviceId);
  if (conn === null) {
    return null;
  }

  if (track.artwork === null) {
    return null;
  }

  const queryDescriptor = {
    trackSlot,
    trackType,
    menuTarget: MenuTarget.Main,
  };

  return conn.query({
    queryDescriptor,
    query: Query.GetArtwork,
    args: {artworkId: track.artwork.id},
    span,
  });
}

export async function viaLocal(
  local: LocalDatabase,
  device: Device,
  opts: Required<Options>,
) {
  const {deviceId, trackSlot, track} = opts;

  if (trackSlot !== MediaSlot.USB && trackSlot !== MediaSlot.SD) {
    throw new Error('Expected USB or SD slot for remote database query');
  }

  const conn = await local.get(deviceId, trackSlot);
  if (conn === null) {
    return null;
  }

  if (track.artwork === null || track.artwork.path === undefined) {
    return null;
  }

  const artworkPath = track.artwork.path;

  try {
    // NOTE: must `await` inside the try - the previous `return fetchFile(...)`
    // returned the promise unawaited, so this catch never actually fired and
    // the rejection propagated to the caller raw.
    return await fetchFile({device, slot: trackSlot, path: artworkPath});
  } catch (error) {
    Sentry.captureException(error);
    // Re-throw with the FULL stored path. The bare NFS error only names the
    // final path segment (e.g. "a23.jpg"), which hides whether the directory
    // resolved and just the file is missing, or the whole path is wrong
    // (e.g. a bare filename looked up at the media root). Callers treat
    // artwork as optional and swallow this, so it only surfaces in logs.
    throw new Error(
      `artwork lookup failed (path="${artworkPath}"): ${(error as Error).message}`,
    );
  }
}
