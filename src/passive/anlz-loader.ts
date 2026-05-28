/**
 * Same shape as src/db/utils.ts anlzLoader, but exposed under passive/
 * so PassiveDatabase doesn't need to import out of src/db/ (which holds
 * the active-mode-only Database class). The runtime behaviour is
 * identical - just an NFS fetchFile bound to (device, slot).
 */

import {fetchFile} from 'src/nfs';
import type {Device, MediaSlot} from 'src/types';

interface AnlzLoaderOpts {
  device: Device;
  slot: MediaSlot.RB | MediaSlot.USB | MediaSlot.SD;
}

export function anlzLoaderForPassive(opts: AnlzLoaderOpts) {
  return (path: string) => fetchFile({...opts, path});
}
