// The servers the browser lab starts for itself: a relay, a chaos proxy per player and the app server.
// Each child is recorded by PID and stopped by that PID alone, never by name or port.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { repoRoot } from '../content-dir.mjs';

const STOP_GRACE_MS = 5000;
const STOP_POLL_MS = 100;
/** A child that has not printed its ready line by then is treated as failed. */
const READY_TIMEOUT_MS = 60000;
/** The relay's dist is stale when a source of these packages is newer than its entry. */
const RELAY_SOURCES = ['packages/net-server/src', 'packages/net-protocol/src', 'packages/lockstep/src'];
const RELAY_ENTRY = 'packages/net-server/dist/main.js';

/** The first port of `range` nothing listens on, tried by binding it on 127.0.0.1; null when all are taken. */
export async function freePort(range, taken = new Set()) {
  for (let port = range.first; port <= range.last; port++) {
    if (taken.has(port)) continue;
    const free = await new Promise((done) => {
      const probe = createServer();
      probe.once('error', () => done(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => done(true)));
    });
    if (free) return port;
  }
  return null;
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

/** Rebuild the relay when a source is newer than its compiled entry; throws when the build fails. */
export function ensureRelayBuild(log) {
  const entry = resolve(repoRoot, RELAY_ENTRY);
  let built = 0;
  try {
    built = statSync(entry).mtimeMs;
  } catch {
    built = 0;
  }
  const newest = Math.max(...RELAY_SOURCES.map((dir) => newestMtime(resolve(repoRoot, dir))));
  if (built >= newest) return false;
  log(`relay dist is stale; building it (tsc --build packages/net-server)`);
  const result = spawnSync('npx', ['tsc', '--build', 'packages/net-server'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`Relay build failed:\n${(result.stdout ?? '') + (result.stderr ?? '')}`.trim());
  return true;
}

/**
 * The children this run started. `start` spawns one with its output in `logDir/<name>.log` and resolves
 * once a line matches `ready`; `stopAll` signals each recorded PID and waits for it to exit. Once
 * `stopAll` began, `start` refuses, so a step that timed out cannot leave a child behind.
 */
export function createProcessSet(logDir, log) {
  const children = [];
  let stopping = false;

  async function start(name, command, args, { env = {}, cwd = repoRoot, ready }) {
    if (stopping) throw new Error(`${name} not started: the lab is stopping`);
    const logPath = join(logDir, `${name}.log`);
    const out = createWriteStream(logPath);
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const record = { name, pid: child.pid, logPath, child, exited: false, code: null };
    children.push(record);
    child.on('exit', (code, signal) => {
      record.exited = true;
      record.code = code ?? signal;
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    log(`started ${name} pid ${child.pid}: ${command} ${args.join(' ')}`);
    await new Promise((done, fail) => {
      let buffered = '';
      const timer = setTimeout(
        () => fail(new Error(`${name} printed no ready line within ${READY_TIMEOUT_MS} ms; see ${logPath}`)),
        READY_TIMEOUT_MS,
      );
      const finish = (error) => {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.off('exit', onExit);
        if (error) fail(error);
        else done();
      };
      const onData = (chunk) => {
        buffered += chunk.toString();
        if (ready.test(buffered)) finish(null);
      };
      const onExit = (code) =>
        finish(new Error(`${name} exited with ${code} before it was ready; see ${logPath}`));
      child.stdout.on('data', onData);
      child.once('exit', onExit);
    });
    return record;
  }

  async function stopOne(record) {
    if (record.exited) return;
    record.child.kill('SIGTERM');
    const deadline = Date.now() + STOP_GRACE_MS;
    while (!record.exited && Date.now() < deadline)
      await new Promise((done) => setTimeout(done, STOP_POLL_MS));
    if (!record.exited) {
      log(`${record.name} pid ${record.pid} ignored SIGTERM; killing it`);
      record.child.kill('SIGKILL');
      while (!record.exited) await new Promise((done) => setTimeout(done, STOP_POLL_MS));
    }
  }

  async function stopAll() {
    stopping = true;
    for (const record of [...children].reverse()) await stopOne(record);
    return children.map(({ name, pid, logPath, code }) => ({ name, pid, logPath, exit: code }));
  }

  return { start, stopAll, list: () => children };
}
