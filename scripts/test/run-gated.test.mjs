import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const GATE = resolve(fileURLToPath(import.meta.url), '../../run-gated.mjs');
/** Long enough that a second run started meanwhile must have queued behind the first. */
const HOLD_MS = 800;
/** No process has this id on any supported platform. */
const DEAD_PID = 2 ** 22 + 1;

/** A Git repository of its own, so the slots live in its `.git`, never the checkout's. */
async function scratchRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'run-gated-'));
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

let scriptCount = 0;

/** Runs `script` through the gate from a file, since Windows passes the command through cmd.exe,
 *  which mangles quotes in an inline `-e` argument; resolves with its exit code. */
async function gated(cwd, script, env = {}) {
  const { CI: _ci, ON_GATE_HELD: _held, ...base } = process.env;
  const file = join(cwd, `script-${scriptCount++}.cjs`);
  await writeFile(file, script);
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [GATE, process.execPath, file], {
      cwd,
      env: { ...base, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.on('error', fail);
    child.on('exit', (code) => done(code));
  });
}

/** A script that logs its start and end times to `log`, holding the slot for `HOLD_MS`. */
function holder(log) {
  const path = JSON.stringify(log);
  return `const fs=require('fs');fs.appendFileSync(${path},'start '+Date.now()+'\\n');setTimeout(()=>fs.appendFileSync(${path},'end '+Date.now()+'\\n'),${HOLD_MS});`;
}

test('a second run waits for the only slot', async () => {
  const repo = await scratchRepo();
  try {
    const log = join(repo, 'log.txt');
    const codes = await Promise.all([
      gated(repo, holder(log), { ON_GATE_SLOTS: '1' }),
      gated(repo, holder(log), { ON_GATE_SLOTS: '1' }),
    ]);
    assert.deepEqual(codes, [0, 0]);
    const events = (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => line.split(' ')[0]);
    assert.deepEqual(events, ['start', 'end', 'start', 'end']);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('a slot left by a dead process is reclaimed', async () => {
  const repo = await scratchRepo();
  try {
    const slot = join(repo, '.git', 'on-gate', 'slot-0');
    await mkdir(slot, { recursive: true });
    await writeFile(join(slot, 'owner.json'), JSON.stringify({ pid: DEAD_PID, cwd: repo, command: 'gone' }));
    assert.equal(await gated(repo, 'process.exit(0)', { ON_GATE_SLOTS: '1' }), 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('the command exit code passes through and the slot is released', async () => {
  const repo = await scratchRepo();
  try {
    assert.equal(await gated(repo, 'process.exit(3)', { ON_GATE_SLOTS: '1' }), 3);
    assert.equal(existsSync(join(repo, '.git', 'on-gate', 'slot-0')), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
