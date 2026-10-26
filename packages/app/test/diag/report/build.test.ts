// @vitest-environment jsdom
import { ReportUpload } from '@open-northland/data';
import { afterEach, describe, expect, it } from 'vitest';
import { diag, setDiagGameSession } from '../../../src/diag/index.js';
import { LIGHT_REPORT_BUDGET_BYTES } from '../../../src/diag/report/budget.js';
import { buildReportDraft, fitCommands } from '../../../src/diag/report/build.js';
import { gzipSize } from '../../../src/diag/report/gzip.js';
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
    window.history.replaceState(null, '', `/?relay=wss://relay.example/ws&room=${ROOM}&nick=Ania`);
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
    expect(text).not.toContain('Ania');
    expect(text).not.toContain('alice');
    expect(report.game?.worldId).toBe(scene.id);
    expect(report.game).not.toHaveProperty('commandLog');
    expect(report.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(report.perf).toEqual({ facts: { frozenMs: 5000 } });
  });

  it('keeps the newest commands and the tick they are complete from when the whole log is over budget', async () => {
    const { report } = await buildReportDraft(null);
    // Each command carries its own noise, so gzip cannot fold the log away.
    const logged = Array.from({ length: 40_000 }, (_, i) => ({
      applyTick: Math.floor(i / 4),
      sequence: i,
      by: 'admin',
      command: { kind: 'noise', value: ((i * 2_654_435_761) % 4_294_967_296).toString(36) },
    }));
    const slice = { commands: logged as never[], fromTick: 0, whole: true };

    const fitted = await fitCommands(report, slice, LIGHT_REPORT_BUDGET_BYTES);

    expect(fitted).not.toBeNull();
    if (fitted === null) return;
    expect(fitted.whole).toBe(false);
    expect(fitted.commands.at(-1)).toBe(logged.at(-1));
    expect(fitted.commands.every((command) => command.applyTick >= fitted.fromTick)).toBe(true);
    expect(logged.filter((command) => command.applyTick >= fitted.fromTick)).toHaveLength(
      fitted.commands.length,
    );
    const size = await gzipSize({ ...report, attachments: { commands: fitted.commands } });
    expect(size).toBeLessThanOrEqual(LIGHT_REPORT_BUDGET_BYTES);
  });
});
