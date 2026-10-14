#!/usr/bin/env node
/** Download or reuse data.zip, validate it, and replace generated content after conversion succeeds. */

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { repoRoot } from './content-dir.mjs';
import { readDataPack, sha256File } from './data-pack.mjs';
import { localDataArchive } from './local-data-env.mjs';
import { extractZip } from './unzip.mjs';

const pin = JSON.parse(await readFile(new URL('./data-release.json', import.meta.url), 'utf8'));
const ARCHIVE_URL = 'https://opennorthland.org/data.zip';
const ARCHIVE_SHA256 = pin.sha256;
const OUT_DIR = resolve(repoRoot, 'content');
const CACHE_DIR = resolve(repoRoot, '.cache', 'data');
const UNPACKED_DIR_NAME = 'unpacked';
const UNPACKED_STAMP_NAME = 'unpacked.sha256';
const LOG_PREFIX = '[build-content]';

function run(command, args, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', fail);
    child.on('exit', (code, signal) => {
      if (code === 0) done();
      else fail(new Error(`${command} ${args[0]} exited with ${signal ?? `status ${String(code)}`}`));
    });
  });
}

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function parseContentLength(value) {
  if (value === null) return undefined;
  const bytes = Number.parseInt(value, 10);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
}

function formatDownloadProgress(receivedBytes, totalBytes) {
  if (totalBytes === undefined) return `downloaded ${formatBytes(receivedBytes)}`;
  const percent = totalBytes === 0 ? 100 : (receivedBytes / totalBytes) * 100;
  return `download progress: ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)} (${percent.toFixed(1)}%)`;
}

async function download(url, target, log, fetchImpl = fetch) {
  const response = await fetchImpl(url);
  if (!response.ok || response.body === null) {
    throw new Error(`${url} answered ${response.status} ${response.statusText}`);
  }
  const totalBytes = parseContentLength(response.headers.get('content-length'));
  const partial = `${target}.part`;
  await mkdir(dirname(target), { recursive: true });
  await rm(partial, { force: true });

  let receivedBytes = 0;
  let lastReportAt = 0;
  let lastReportedBytes = -1;
  const reportProgress = (force = false) => {
    const now = Date.now();
    if (!force && now - lastReportAt < 1000) return;
    if (!force && receivedBytes === lastReportedBytes) return;
    lastReportAt = now;
    lastReportedBytes = receivedBytes;
    log(formatDownloadProgress(receivedBytes, totalBytes));
  };
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      reportProgress(false);
      callback(null, chunk);
    },
    flush(callback) {
      reportProgress(true);
      callback();
    },
  });

  reportProgress(true);
  try {
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial));
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

function createLogger(out = process.stderr) {
  const startedAt = Date.now();
  return (message) => {
    const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    out.write(`${LOG_PREFIX} +${elapsedSeconds}s ${message}\n`);
  };
}

async function buildContent(zip, log) {
  const dataRoot = await obtainPinnedDataRoot(zip, log);
  if (existsSync(OUT_DIR) && (await lstat(OUT_DIR)).isSymbolicLink())
    throw new Error('Refusing to replace content through a symlink');
  const staging = await mkdtemp(resolve(repoRoot, '.cache', 'content-'));
  const previous = `${staging}-previous`;
  try {
    if (existsSync(join(OUT_DIR, 'music')))
      await cp(join(OUT_DIR, 'music'), join(staging, 'music'), { recursive: true });
    log(`running asset pipeline into ${staging}`);
    await run('npm', ['run', 'pipeline', '--', '--data-root', dataRoot, '--out', staging], repoRoot);
    if (existsSync(OUT_DIR)) await rename(OUT_DIR, previous);
    try {
      await rename(staging, OUT_DIR);
    } catch (error) {
      if (existsSync(previous)) await rename(previous, OUT_DIR);
      throw error;
    }
    await rm(previous, { recursive: true, force: true });
    log(`${OUT_DIR} built from data.zip`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function cachedArchivePath(outDir, archiveUrl) {
  const archiveName = basename(new URL(archiveUrl).pathname);
  if (archiveName === '') throw new Error(`cannot derive an archive name from ${archiveUrl}`);
  return join(outDir, archiveName);
}

function sha256MismatchError(path, actualDigest, expectedDigest) {
  return new Error(
    `${path} is not the pinned data archive: sha256 ${actualDigest}, expected ${expectedDigest}`,
  );
}

async function verifyArchiveSha256(path, expectedDigest, log) {
  log(`verifying sha256 of ${path}`);
  const actualDigest = await sha256File(path);
  if (actualDigest !== expectedDigest) throw sha256MismatchError(path, actualDigest, expectedDigest);
}

function unpackedCachePath(outDir) {
  return join(outDir, UNPACKED_DIR_NAME);
}

function unpackedStampPath(outDir) {
  return join(outDir, UNPACKED_STAMP_NAME);
}

async function cachedDataRoot(outDir, expectedDigest) {
  const unpackedDir = unpackedCachePath(outDir);
  const stampPath = unpackedStampPath(outDir);
  if (!existsSync(unpackedDir) || !existsSync(stampPath)) return undefined;

  const actualDigest = (await readFile(stampPath, 'utf8')).trim();
  if (actualDigest !== expectedDigest) return undefined;

  try {
    await readDataPack(unpackedDir);
  } catch {
    return undefined;
  }
  return unpackedDir;
}

export async function obtainPinnedArchive(
  zip,
  log,
  { outDir = CACHE_DIR, archiveUrl = ARCHIVE_URL, expectedDigest = ARCHIVE_SHA256, fetchImpl = fetch } = {},
) {
  if (zip !== undefined) {
    log(`using local archive ${zip}`);
    await verifyArchiveSha256(zip, expectedDigest, log);
    return zip;
  }

  const archive = cachedArchivePath(outDir, archiveUrl);
  await mkdir(outDir, { recursive: true });
  if (!existsSync(archive)) {
    log(`cached archive missing, downloading ${archiveUrl} into ${archive}`);
    await download(archiveUrl, archive, log, fetchImpl);
  } else {
    log(`using cached archive ${archive}`);
  }

  try {
    await verifyArchiveSha256(archive, expectedDigest, log);
  } catch (_error) {
    log(`cached archive failed verification, re-downloading ${archiveUrl}`);
    await download(archiveUrl, archive, log, fetchImpl);
    await verifyArchiveSha256(archive, expectedDigest, log);
  }
  return archive;
}

export async function obtainPinnedDataRoot(
  zip,
  log,
  {
    outDir = CACHE_DIR,
    archiveUrl = ARCHIVE_URL,
    expectedDigest = ARCHIVE_SHA256,
    fetchImpl = fetch,
    extractImpl = extractZip,
  } = {},
) {
  const archive = await obtainPinnedArchive(zip, log, { outDir, archiveUrl, expectedDigest, fetchImpl });
  const cached = await cachedDataRoot(outDir, expectedDigest);
  if (cached !== undefined) {
    log(`using cached unpacked data ${cached}`);
    return cached;
  }

  await mkdir(outDir, { recursive: true });
  const unpackedDir = unpackedCachePath(outDir);
  const stampPath = unpackedStampPath(outDir);
  const partialDir = await mkdtemp(join(outDir, `${UNPACKED_DIR_NAME}.part-`));
  log(`cached unpacked data missing or stale, extracting ${archive} into ${unpackedDir}`);
  try {
    await extractImpl(archive, partialDir);
    await readDataPack(partialDir);
    await rm(unpackedDir, { recursive: true, force: true });
    await rename(partialDir, unpackedDir);
    await writeFile(stampPath, `${expectedDigest}\n`);
    const cachedRoot = unpackedDir;
    log(`cached unpacked data at ${cachedRoot}`);
    return cachedRoot;
  } catch (error) {
    await rm(partialDir, { recursive: true, force: true });
    throw error;
  }
}

export async function main({ args = process.argv.slice(2), env = process.env, log = createLogger() } = {}) {
  if (args.length)
    throw new Error('build:content takes no arguments; set ON_DATA_ZIP in .env for local data');
  log('starting content build');
  await buildContent(localDataArchive(repoRoot, env), log);
}

const isMain = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const log = createLogger();
  try {
    await main({ log });
  } catch (err) {
    log(`failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
