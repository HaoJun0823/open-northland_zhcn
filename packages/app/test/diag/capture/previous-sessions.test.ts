// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureContext } from '../../../src/diag/capture/context.js';
import { reportPreviousSessions } from '../../../src/diag/capture/previous-sessions.js';
import { writeMarker } from '../../../src/diag/capture/session-marker.js';
import { MARKER_STALE_MS } from '../../../src/diag/capture/unclean-exit.js';
import type { FreezeRecord } from '../../../src/diag/capture/watchdog/freeze-records.js';
import { BOOT_FREEZE_REPORT_MS } from '../../../src/diag/capture/watchdog/freeze-watch.js';
import { type Problem, setProblemSink } from '../../../src/diag/report/problem.js';
import type { DesktopFault, DesktopFaults } from '../../../src/view/platform/desktop-faults.js';

const store = vi.hoisted(() => ({ records: [] as unknown[], deleted: [] as string[] }));
vi.mock('../../../src/diag/capture/watchdog/freeze-records.js', () => ({
  readFreezeRecords: () => Promise.resolve(store.records),
  deleteFreezeRecords: (ids: readonly string[]) => {
    store.deleted.push(...ids);
    return Promise.resolve();
  },
}));

const NOW = 10_000_000;
const LONG_AGO = NOW - 100 * MARKER_STALE_MS;
const OWN = { id: '0'.repeat(32), startedAt: NOW - 1000 };
const BOOTING: CaptureContext = {
  entry: 'map',
  search: '?map=x',
  worldId: null,
  tick: null,
  inGame: false,
  booting: true,
};

function bootFreeze(id: string, lastedMs: number): FreezeRecord {
  return { id, tabId: id, frozenAt: LONG_AGO, seenAt: LONG_AGO + lastedMs, context: BOOTING };
}

function shellFault(id: string, trigger: DesktopFault['trigger'], atMs: number): DesktopFault {
  return {
    id,
    trigger,
    at: new Date(atMs).toISOString(),
    reason: trigger,
    exitCode: null,
    durationMs: null,
    stack: null,
    url: null,
  };
}

const hang = (id: string, atMs: number): DesktopFault => shellFault(id, 'renderer-unresponsive', atMs);

function shellWith(pending: readonly DesktopFault[], cleared: string[] = []): void {
  const faults: DesktopFaults = {
    pending: () => Promise.resolve(pending),
    clear: (ids) => {
      cleared.push(...ids);
      return Promise.resolve();
    },
    versions: () => Promise.resolve({}),
  };
  Object.defineProperty(window, 'desktop', { value: { faults }, configurable: true });
}

let problems: Problem[];

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  problems = [];
  setProblemSink((problem) => problems.push(problem));
  store.records = [];
  store.deleted = [];
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'desktop');
});

describe('reportPreviousSessions', () => {
  it('reports a boot closed while frozen only once it froze for long, for as long as it froze', async () => {
    const short = bootFreeze('a'.repeat(32), BOOT_FREEZE_REPORT_MS / 4);
    const stuck = bootFreeze('b'.repeat(32), BOOT_FREEZE_REPORT_MS + 5000);
    store.records = [short, stuck];
    await reportPreviousSessions(OWN, null);
    expect(problems.map((problem) => [problem.earlier?.id, problem.facts?.freezeMs])).toEqual([
      [stuck.id, BOOT_FREEZE_REPORT_MS + 5000],
    ]);
    expect(store.deleted.sort()).toEqual([short.id, stuck.id]);
  });

  it('reports a game that ended unclean after a short boot freeze, and a boot that ended so not', async () => {
    const played = bootFreeze('5'.repeat(32), BOOT_FREEZE_REPORT_MS / 4);
    const booted = bootFreeze('6'.repeat(32), BOOT_FREEZE_REPORT_MS / 4);
    store.records = [played, booted];
    const marker = { startedAt: LONG_AGO - 1000, beatAt: LONG_AGO + 30_000, visible: true };
    writeMarker({ id: played.id, ...marker, context: { ...BOOTING, inGame: true, booting: false } });
    writeMarker({ id: booted.id, ...marker, context: BOOTING });
    await reportPreviousSessions(OWN, null);
    expect(problems.map((problem) => [problem.trigger, problem.earlier?.id])).toEqual([
      ['unclean-exit', played.id],
    ]);
    expect(store.deleted.sort()).toEqual([played.id, booted.id]);
  });

  it("forgets the shell's hang of a short boot freeze, and leaves this page's own hang to it", async () => {
    const freeze = bootFreeze('c'.repeat(32), BOOT_FREEZE_REPORT_MS / 4);
    store.records = [freeze];
    writeMarker({
      id: freeze.id,
      startedAt: LONG_AGO - 1000,
      beatAt: LONG_AGO,
      visible: true,
      context: BOOTING,
    });
    const theirs = hang('d'.repeat(32), LONG_AGO + 1000);
    const ours = hang('e'.repeat(32), OWN.startedAt + 1);
    const cleared: string[] = [];
    shellWith([theirs, ours], cleared);
    await reportPreviousSessions(OWN, null);
    expect(problems).toEqual([]);
    expect(cleared).toEqual([theirs.id]);
  });

  it("tells the shell's faults of a previous session from those of this page", async () => {
    const before = shellFault('f'.repeat(32), 'error', OWN.startedAt - 1);
    const since = shellFault('1'.repeat(32), 'gpu-gone', OWN.startedAt + 1);
    shellWith([before, since]);
    await reportPreviousSessions(OWN, null);
    expect(problems.map((problem) => [problem.trigger, problem.earlier?.previousSession])).toEqual([
      ['error', true],
      ['gpu-gone', false],
    ]);
  });
});
