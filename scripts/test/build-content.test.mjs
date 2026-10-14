import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { obtainPinnedArchive, obtainPinnedDataRoot } from '../build-content.mjs';
import { syntheticPack } from './support/data-pack.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('prints stage logs to stderr before rejecting a non-pinned archive', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const archive = join(dir, 'fake.zip');
  await writeFile(archive, 'definitely not the pinned data archive');

  const result = spawnSync(process.execPath, ['scripts/build-content.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, ON_DATA_ZIP: archive },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /\[build-content\] \+\d+\.\d+s starting content build/);
  assert.match(result.stderr, new RegExp(`using local archive .*${basename(archive)}`));
  assert.match(result.stderr, new RegExp(`verifying sha256 of .*${basename(archive)}`));
  assert.match(result.stderr, /failed: .*is not the pinned data archive: sha256 /);
});

test('caches the downloaded archive in content and reports progress', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-cache-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from('cultures-nation-archive');
  const expectedDigest = createHash('sha256').update(payload).digest('hex');
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(payload.length));
    res.write(payload.subarray(0, 7));
    setTimeout(() => res.end(payload.subarray(7)), 10);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const archiveUrl = `http://127.0.0.1:${server.address().port}/data-test.zip`;
  const firstLogs = [];
  const archive = await obtainPinnedArchive(undefined, (message) => firstLogs.push(message), {
    outDir: dir,
    archiveUrl,
    expectedDigest,
  });

  assert.equal(archive, join(dir, 'data-test.zip'));
  assert.equal(requests, 1);
  assert.match(firstLogs.join('\n'), /cached archive missing, downloading /);
  assert.match(firstLogs.join('\n'), new RegExp(`download progress: 0 B / ${payload.length} B \\(0\\.0%\\)`));
  assert.match(
    firstLogs.join('\n'),
    new RegExp(`download progress: ${payload.length} B / ${payload.length} B \\(100\\.0%\\)`),
  );

  const secondLogs = [];
  const cached = await obtainPinnedArchive(undefined, (message) => secondLogs.push(message), {
    outDir: dir,
    archiveUrl,
    expectedDigest,
  });

  assert.equal(cached, archive);
  assert.equal(requests, 1);
  assert.match(secondLogs.join('\n'), /using cached archive /);
  assert.doesNotMatch(secondLogs.join('\n'), /cached archive missing, downloading /);
});

test('reuses the unpacked data cache under content', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'build-content-unpacked-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const payload = Buffer.from('cultures-nation-archive');
  const archive = join(dir, 'data.zip');
  const expectedDigest = createHash('sha256').update(payload).digest('hex');
  await writeFile(archive, payload);

  let extracts = 0;
  const extractImpl = async (_archive, outDir) => {
    extracts++;
    await syntheticPack(outDir);
  };

  const firstLogs = [];
  const firstRoot = await obtainPinnedDataRoot(archive, (message) => firstLogs.push(message), {
    outDir: dir,
    expectedDigest,
    extractImpl,
  });

  assert.equal(firstRoot, join(dir, 'unpacked'));
  assert.equal(extracts, 1);
  assert.match(firstLogs.join('\n'), /cached unpacked data missing or stale, extracting /);
  assert.match(firstLogs.join('\n'), /cached unpacked data at /);

  const secondLogs = [];
  const secondRoot = await obtainPinnedDataRoot(archive, (message) => secondLogs.push(message), {
    outDir: dir,
    expectedDigest,
    extractImpl,
  });

  assert.equal(secondRoot, firstRoot);
  assert.equal(extracts, 1);
  assert.match(secondLogs.join('\n'), /using cached unpacked data /);
  assert.doesNotMatch(secondLogs.join('\n'), /cached unpacked data missing or stale, extracting /);
});

test('repairs a modified unpacked cache and rejects a mismatching explicit archive without network', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'data-repair-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const archive = join(dir, 'data.zip');
  await writeFile(archive, 'source');
  const expectedDigest = createHash('sha256').update('source').digest('hex');
  let extracts = 0;
  const options = {
    outDir: dir,
    expectedDigest,
    extractImpl: async (_, root) => {
      extracts++;
      await syntheticPack(root);
    },
    fetchImpl: () => {
      throw new Error('must not fetch');
    },
  };
  const root = await obtainPinnedDataRoot(archive, () => {}, options);
  await writeFile(join(root, 'base/DataCnmd/types/example.ini'), 'tampered');
  await obtainPinnedDataRoot(archive, () => {}, options);
  assert.equal(extracts, 2);
  await writeFile(archive, 'bad');
  await assert.rejects(
    obtainPinnedDataRoot(archive, () => {}, options),
    /not the pinned data archive/,
  );
});
