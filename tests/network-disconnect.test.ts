import {afterEach, describe, expect, it} from 'vitest';

import {bringOnline} from 'src/network';

/**
 * Regression guard for the adaptive-agent fix: bringOnline() binds the three
 * Pro DJ Link UDP sockets immediately, so disconnect() MUST free them even on a
 * network that was never configured/connected (e.g. autoconfigFromPeers timed
 * out on an empty roster). Previously disconnect() threw "Network must be
 * configured" before reaching udpClose, leaking the sockets. These tests bind
 * only local UDP ports (50000-50002) - no CDJ hardware required.
 */
describe('ProlinkNetwork.disconnect() when never configured', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const opened: any[] = [];
  afterEach(async () => {
    // Make sure every network we opened is torn down so ports free between tests.
    while (opened.length) {
      const n = opened.pop();
      try {
        await n.disconnect();
      } catch {
        // already closed
      }
    }
  });

  it('resolves instead of throwing on an unconfigured network', async () => {
    const network = await bringOnline();
    let caught: unknown = null;
    try {
      await network.disconnect();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeNull();
  });

  it('frees the sockets so a fresh bringOnline() can rebind the ports', async () => {
    const first = await bringOnline();
    await first.disconnect();

    // If disconnect() had left the sockets bound, this rebind of the same
    // well-known ports is what would eventually fail.
    const second = await bringOnline();
    opened.push(second);
    expect(second).toBeDefined();
  });
});
