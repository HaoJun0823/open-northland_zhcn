/**
 * What a problem gets: a dialog, a report sent without asking, a report held for the open dialog's
 * Send, or only a count. A broken frame loop can throw sixty times a second and a player on a
 * metered link must not pay for a flood, so a session sends few reports by itself; a player's own Send
 * is not limited, and a problem that stopped the game always shows.
 */
import type { Problem } from './problem.js';

export const MAX_AUTOMATIC_REPORTS = 5;

/** At most {@link MAX_AUTOMATIC_REPORTS}, one per key. */
class SessionLimit {
  private taken = 0;
  private readonly keys = new Set<string>();

  /** Whether one more with this key fits; a yes counts it. */
  take(key: string): boolean {
    if (this.taken >= MAX_AUTOMATIC_REPORTS || this.keys.has(key)) return false;
    this.taken++;
    this.keys.add(key);
    return true;
  }
}

export interface Gate {
  /** A new dialog, the open dialog turned to the stopped game, or nothing on screen. */
  readonly show: 'dialog' | 'stopped' | 'none';
  readonly send: boolean;
  readonly hold: boolean;
}

const IGNORED: Gate = { show: 'none', send: false, hold: false };

export class ProblemGate {
  private readonly sent = new SessionLimit();
  /** The same caps for reports an open dialog's Send takes along while automatic sending is off. */
  private readonly held = new SessionLimit();
  /** A key that already had a dialog this session raises none again, unless its problem is fatal. */
  private readonly shown = new Set<string>();
  /** An earlier page's problem can reach this page twice (a frozen tab seen by a new one, then its
   *  own recovery), with the same id. */
  private readonly earlierIds = new Set<string>();

  decide(problem: Problem, key: string, automatic: boolean, dialogOpen: boolean): Gate {
    const earlierId = problem.earlier?.id;
    if (earlierId !== undefined) {
      if (this.earlierIds.has(earlierId)) return IGNORED;
      this.earlierIds.add(earlierId);
    }
    const send = automatic && this.sent.take(key);
    const hold = !automatic && dialogOpen && this.held.take(key);
    let show: Gate['show'] = 'none';
    if (problem.fatal === true) show = dialogOpen ? 'stopped' : 'dialog';
    else if (!dialogOpen && !this.shown.has(key)) show = 'dialog';
    if (show === 'dialog') this.shown.add(key);
    return { show, send, hold };
  }
}
