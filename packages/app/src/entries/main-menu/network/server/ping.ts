/** Round trip in milliseconds, or null when the relay did not answer. */
export type RelayPing = (relayUrl: string) => Promise<number | null>;

/** The first request also pays DNS, TCP and TLS; the samples after it ride the warm connection. */
const WARM_SAMPLES = 3;
const SAMPLE_TIMEOUT_MS = 4000;

/**
 * Time the relay's health endpoint over its own origin. The relay sends no CORS headers, so the
 * request is `no-cors`: the answer stays opaque, but its arrival is the round trip.
 */
export const pingRelay: RelayPing = async (relayUrl) => {
  const health = new URL('/healthz', relayUrl.replace(/^ws/, 'http'));
  if (!(await sample(health))) return null;
  let best: number | null = null;
  for (let i = 0; i < WARM_SAMPLES; i++) {
    const started = performance.now();
    if (!(await sample(health))) continue;
    const elapsed = performance.now() - started;
    best = best === null ? elapsed : Math.min(best, elapsed);
  }
  return best === null ? null : Math.round(best);
};

async function sample(health: URL): Promise<boolean> {
  const url = new URL(health);
  url.searchParams.set('t', String(performance.now()));
  try {
    await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(SAMPLE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}
