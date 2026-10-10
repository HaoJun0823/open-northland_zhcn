#!/usr/bin/env node
// Runs a heavy local command (test suite, build) once a machine-wide slot is free, at lowered
// priority. Every worktree shares the Git common directory, so parallel sessions queue on the same
// slots instead of oversubscribing the CPU. CI runs the command directly.
//
//   node scripts/run-gated.mjs <command> [args...]
//
// ON_GATE_SLOTS sets the number of concurrent heavy runs (default 2). A command started by a gated
// run is already inside its slot and runs directly.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_SLOTS = 2;
/** Low enough that the desktop and agent CLIs stay responsive, high enough not to starve the run. */
const NICENESS = 10;
const POLL_MS = 2000;
/** A slot whose owner file is still missing after this long lost its owner between mkdir and write. */
const ORPHAN_SLOT_MS = 60_000;
const HELD_ENV = 'ON_GATE_HELD';
const OWNER_FILE = 'owner.json';

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('usage: node scripts/run-gated.mjs <command> [args...]');
  process.exit(2);
}

const gated = !process.env.CI && process.env[HELD_ENV] !== '1';
const slot = gated ? await acquireSlot(slotRoot(), slotCount()) : undefined;
if (gated) lowerPriority();

const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  env: { ...process.env, [HELD_ENV]: '1' },
  // npm and vitest are .cmd shims on Windows.
  shell: process.platform === 'win32',
});
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => {
  releaseSlot(slot);
  process.exit(code ?? (signal ? 1 : 0));
});
child.on('error', (error) => {
  releaseSlot(slot);
  console.error(`run-gated: ${error.message}`);
  process.exit(1);
});

function slotCount() {
  const raw = process.env.ON_GATE_SLOTS;
  if (raw === undefined || raw === '') return DEFAULT_SLOTS;
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) {
    console.error(`run-gated: ON_GATE_SLOTS must be a positive integer, got '${raw}'`);
    process.exit(2);
  }
  return count;
}

function slotRoot() {
  let base;
  try {
    base = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    base = tmpdir();
  }
  const root = join(base, 'on-gate');
  mkdirSync(root, { recursive: true });
  return root;
}

async function acquireSlot(root, count) {
  let announced = false;
  for (;;) {
    for (let index = 0; index < count; index++) {
      const dir = join(root, `slot-${index}`);
      if (tryClaim(dir)) return dir;
    }
    if (!announced) {
      console.error(
        `run-gated: ${count} heavy run(s) already active (${describeHolders(root, count)}); waiting`,
      );
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function tryClaim(dir) {
  try {
    mkdirSync(dir);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!isStale(dir)) return false;
    rmSync(dir, { recursive: true, force: true });
    try {
      mkdirSync(dir);
    } catch {
      return false;
    }
  }
  const owner = { pid: process.pid, cwd: process.cwd(), command: command.join(' ') };
  writeFileSync(join(dir, OWNER_FILE), JSON.stringify(owner));
  return true;
}

function readOwner(dir) {
  try {
    return JSON.parse(readFileSync(join(dir, OWNER_FILE), 'utf8'));
  } catch {
    return undefined;
  }
}

function isStale(dir) {
  const owner = readOwner(dir);
  if (owner === undefined) {
    try {
      return Date.now() - statSync(dir).mtimeMs > ORPHAN_SLOT_MS;
    } catch {
      return true;
    }
  }
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

function describeHolders(root, count) {
  const holders = [];
  for (let index = 0; index < count; index++) {
    const owner = readOwner(join(root, `slot-${index}`));
    if (owner !== undefined) holders.push(`pid ${owner.pid} in ${owner.cwd}`);
  }
  return holders.join(', ') || 'owners unknown';
}

function releaseSlot(dir) {
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
}

function lowerPriority() {
  try {
    setPriority(NICENESS);
  } catch {
    // An unprivileged process may be unable to change priority on some platforms; run anyway.
  }
}
