export * from './entities';
export * from './mixstatus';
export * from './network';

// Re-export the NFS file-fetch primitive so consumers can pull arbitrary
// files (audio, artwork, .pdb) off a CDJ's exported USB/SD/RB slot. This
// is the same machinery used internally for rekordbox database fetches;
// exposing it lets downstream agents do audio fingerprinting + other
// per-track work without re-implementing the CDJ's NFS dialect.
//
// Upstream prolink-connect doesn't export this today. If/when our PR
// lands the export here moves to the public surface unchanged.
export {fetchFile, resetDeviceCache, configureRetryStrategy} from './nfs';
export type {FetchProgress} from './nfs';

// Passive mode (pcap-based monitoring without announcing a VCDJ). Lets us
// observe Pro DJ Link traffic and pull NFS metadata without ever appearing
// on the device roster - sidesteps the 6-CDJ player cap. Cherry-picked
// from chrisle/alphatheta-connect.
export * from './passive';

// Types are exported last to avoid overwriting values with type-only exports
export * from './types';
