// @vitest-environment jsdom
import { ReportUpload } from '@open-northland/data';
import { afterEach, describe, expect, it } from 'vitest';
import { diag, setDiagGameSession } from '../../../src/diag/index.js';
import { buildReportDraft, reportNet } from '../../../src/diag/report/build.js';
import { createSceneSim, SCENES } from '../../../src/scenes/index.js';
import { inlineSessionHost } from '../../../src/session/index.js';

const scene = SCENES[0];
if (scene === undefined) throw new Error('no registered scenes');
const ROOM = 'room-key-7f3a';

afterEach(() => {
  setDiagGameSession(null);
  window.history.replaceState(null, '', '/');
});

describe('bug report draft', () => {
  it('builds a light report the API accepts, without secrets, home paths or the command log in its game', async () => {
    window.history.replaceState(null, '', `/?relay=wss://relay.example/ws&room=${ROOM}&nick=Ola`);
    const sim = createSceneSim(scene);
    for (let tick = 0; tick < 3; tick++) sim.step();
    setDiagGameSession({
      entry: 'scene',
      worldId: scene.id,
      seed: scene.seed,
      host: inlineSessionHost(sim),
      hashTrace: null,
    });
    diag.info('boot', 'environment', { href: window.location.href });
    diag.warn('content', 'missing /Users/alice/Games/cultures/data.zip');
    diag.info('net', 'Ola joined the room');

    const { report, commands } = await buildReportDraft({
      trigger: 'error',
      error: {
        thread: 'main',
        name: 'TypeError',
        message: 'x is undefined',
        stack: 'TypeError: x is undefined\n    at f (file:///C:/Users/alice/app/index-AbCd1234.js:1:2)',
      },
      facts: { frozenMs: 5000 },
    });
    const upload =
      commands === null ? report : { ...report, attachments: { commands: [...commands.commands] } };

    expect(ReportUpload.safeParse(JSON.parse(JSON.stringify(upload))).success).toBe(true);
    expect(report.route).toEqual({
      entry: 'relay',
      params: { relay: 'wss://relay.example/ws', room: '[redacted]', nick: '[redacted]' },
    });
    const text = JSON.stringify(report);
    expect(text).not.toContain(ROOM);
    expect(text).not.toContain('Ola');
    expect(text).not.toContain('alice');
    expect(report.game?.worldId).toBe(scene.id);
    expect(report.game).not.toHaveProperty('commandLog');
    expect(report.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(report.perf).toEqual({ facts: { frozenMs: 5000 } });
  });

  it("names other players by seat and leaves a large verdict's digest inputs to the download", () => {
    const big = { allocations: 'x'.repeat(100_000) };
    const net = reportNet({
      desync: { tick: 7, domains: [], reference: 'Ania' },
      digests: [],
      dispute: {
        role: 'diverged',
        tick: 7,
        domains: [],
        counterparts: ['Ania', 'Gone'],
        inputs: big as never,
      },
      delayTicks: 2,
      roundTripMs: 80,
      seats: { Ania: 1, Me: 0 },
    });
    expect(JSON.stringify(net)).not.toContain('Ania');
    expect(net).toMatchObject({
      desync: { referenceSeat: 1 },
      dispute: { counterpartSeats: [1, 'unknown'] },
    });
    expect(net).not.toHaveProperty('dispute.inputs');
  });
});
