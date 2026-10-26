/**
 * How many reports a session sends without asking: a broken frame loop can throw sixty times a
 * second, and a player on a metered link must not pay for a flood. A player's own Send is not limited.
 */
export const MAX_AUTOMATIC_REPORTS = 5;

export class AutomaticLimits {
  private sent = 0;
  private readonly fingerprints = new Set<string>();

  /** Whether a report with this fingerprint may go out now; a yes counts it. */
  take(fingerprint: string): boolean {
    if (this.sent >= MAX_AUTOMATIC_REPORTS || this.fingerprints.has(fingerprint)) return false;
    this.sent++;
    this.fingerprints.add(fingerprint);
    return true;
  }
}
