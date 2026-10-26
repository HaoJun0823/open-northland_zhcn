import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadMaps, symbolicateValue } from '../../report/symbolicate.mjs';

const SCRIPT = fileURLToPath(new URL('../../report/symbolicate.mjs', import.meta.url));
const CLIENT = 'a'.repeat(64);

// Generated line 1: column 0 maps to boom.ts 1:0, column 9 to boom.ts 3:4 (0-based); line 2 has none.
const MAP = {
  version: 3,
  file: 'index-abc.js',
  sources: ['../../src/boom.ts'],
  names: [],
  mappings: 'AAAA,SAEI;',
};

async function mapsDir() {
  const dir = await mkdtemp(join(tmpdir(), 'on-symbolicate-'));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'assets/index-abc.js.map'), JSON.stringify(MAP));
  await writeFile(
    join(dir, 'build.json'),
    JSON.stringify({ version: '1.2.3', client: CLIENT, content: null }),
  );
  return dir;
}

function report(stack) {
  return {
    id: '0'.repeat(32),
    part: 'report',
    trigger: 'error',
    build: { version: '1.2.3', client: CLIENT },
    error: { thread: 'main', name: 'Error', message: 'boom', stack },
    log: {
      entries: [
        {
          timeMs: 5,
          channel: 'net',
          level: 'error',
          message: 'x',
          data: { stack: 'f@app://game/assets/index-abc.js:1:3' },
        },
      ],
      dropped: 0,
    },
  };
}

test('frames a map covers become repository positions and the rest stay as sent', async (t) => {
  const dir = await mapsDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const counts = { frames: 0, mapped: 0 };
  const stack = [
    'Error: boom',
    '    at Ue (https://game.opennorthland.org/assets/index-abc.js:1:12)',
    '    at https://game.opennorthland.org/assets/index-abc.js:2:4',
    '    at https://game.opennorthland.org/assets/other-def.js:1:1',
  ].join('\n');
  const mapped = symbolicateValue(report(stack), loadMaps(dir), counts);
  assert.equal(
    mapped.error.stack,
    [
      'Error: boom',
      '    at Ue (packages/app/src/boom.ts:3:5)',
      '    at https://game.opennorthland.org/assets/index-abc.js:2:4',
      '    at https://game.opennorthland.org/assets/other-def.js:1:1',
    ].join('\n'),
  );
  assert.equal(mapped.log.entries[0].data.stack, 'f@packages/app/src/boom.ts:1:1');
  assert.deepEqual(counts, { frames: 4, mapped: 2 });
});

test('the command warns when the maps are of another build', async (t) => {
  const dir = await mapsDir();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'report.json');
  await writeFile(
    file,
    JSON.stringify({
      ...report('at f (/assets/index-abc.js:1:10)'),
      build: { version: '1.2.4', client: 'b' },
    }),
  );
  const run = spawnSync(process.execPath, [SCRIPT, dir, dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /at f \(packages\/app\/src\/boom\.ts:3:5\)/);
  assert.match(run.stderr, /the report is from 1\.2\.4 .* the maps from 1\.2\.3/);
});
