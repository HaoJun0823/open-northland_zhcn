import { type FileHandle, mkdtemp, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/catalog/snapshot.js';
import { ArchiveVerificationBusyError, ArchiveVerifier } from '../../src/conversion/archive-verifier.js';

const ARCHIVE = Buffer.alloc(8 * 1024 * 1024, 7);
const HASH = sha256Hex(ARCHIVE);

/** Deep equality on megabytes of bytes costs seconds; compare buffers natively instead. */
const expectArchiveBytes = (bytes: Buffer | undefined): void => {
  expect(bytes?.equals(ARCHIVE), 'handle reads the verified archive bytes').toBe(true);
};

/**
 * Puts other bytes under the open name while its hash runs. POSIX answers a rename over the open
 * name; Windows refuses to rename onto a file another handle holds, so it overwrites in place there.
 * Either way the verifier reads bytes other than the ones it verified.
 */
async function swapDuringHash(path: string, replacement: string): Promise<void> {
  if (process.platform !== 'win32') return rename(replacement, path);
  const bytes = await readFile(replacement);
  await writeFile(path, bytes);
  await rm(replacement, { force: true });
}

describe('retained archive verification', () => {
  let dir: string;
  let path: string;
  let verifier: ArchiveVerifier;
  let prototype: Pick<FileHandle, 'createReadStream'>;
  let original: FileHandle['createReadStream'];
  let bytesRead: number;
  let passes: number;
  let active: number;
  let peak: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'on-api-verification-'));
    path = join(dir, 'archive.bin');
    await writeFile(path, ARCHIVE);
    const probe = await open(path);
    prototype = Object.getPrototypeOf(probe) as Pick<FileHandle, 'createReadStream'>;
    original = prototype.createReadStream;
    await probe.close();
    verifier = new ArchiveVerifier();
    bytesRead = passes = active = peak = 0;
    vi.spyOn(prototype, 'createReadStream').mockImplementation(function (this: FileHandle, options) {
      passes += 1;
      active += 1;
      peak = Math.max(peak, active);
      const stream = original.call(this, options);
      stream.on('data', (bytes: Buffer) => {
        bytesRead += bytes.length;
      });
      let finished = false;
      const done = () => {
        if (!finished) active -= 1;
        finished = true;
      };
      stream.once('end', done);
      stream.once('error', done);
      return stream;
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it('coalesces concurrent readers and reuses verification without retaining open handles', async () => {
    const handles = await Promise.all(Array.from({ length: 12 }, () => verifier.open(path, HASH)));
    expect(handles.every((handle) => handle !== null)).toBe(true);
    for (const handle of handles) await handle?.close();
    for (let repeat = 0; repeat < 3; repeat++) await (await verifier.open(path, HASH))?.close();
    expect({ passes, bytesRead, peak }).toEqual({
      passes: 1,
      bytesRead: ARCHIVE.length,
      peak: 1,
    });
  });

  it('invalidates same-size writes and atomic replacements, even with the expected file name', async () => {
    await (await verifier.open(path, HASH))?.close();
    await writeFile(path, Buffer.alloc(ARCHIVE.length, 8));
    expect(await verifier.open(path, HASH)).toBeNull();
    const replacement = join(dir, 'replacement');
    await writeFile(replacement, ARCHIVE);
    await rename(replacement, path);
    const valid = await verifier.open(path, HASH);
    expect(valid).not.toBeNull();
    await valid?.close();
    expect(passes).toBe(3);
  });

  it("never returns replacement bytes under the verified inode's hash", async () => {
    const replacement = join(dir, 'replacement');
    await writeFile(replacement, Buffer.alloc(ARCHIVE.length, 9));
    let replace: Promise<void> | undefined;
    vi.spyOn(prototype, 'createReadStream').mockImplementationOnce(function (this: FileHandle, options) {
      const stream = original.call(this, options);
      stream.once('data', () => {
        replace = swapDuringHash(path, replacement);
      });
      return stream;
    });
    const handle = await verifier.open(path, HASH);
    await replace;
    // Unlinking can update the old inode's ctime; refusal is also safe in that case.
    if (handle !== null) {
      try {
        expectArchiveBytes(await handle.readFile());
      } finally {
        await handle.close();
      }
    }
    expect(await verifier.open(path, HASH)).toBeNull();
  });

  it('caps hashing concurrency and rejects excess admission before opening more files', async () => {
    const paths = Array.from({ length: 40 }, (_, index) => join(dir, `${index}.bin`));
    const bytes = ARCHIVE.subarray(0, 256 * 1024);
    const hash = sha256Hex(bytes);
    await Promise.all(paths.map((name) => writeFile(name, bytes)));
    const results = await Promise.allSettled(paths.map((name) => verifier.open(name, hash)));
    for (const result of results) if (result.status === 'fulfilled') await result.value?.close();
    expect(peak).toBeLessThanOrEqual(2);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(32);
    const refused = results.filter((result) => result.status === 'rejected');
    expect(refused).toHaveLength(8);
    for (const result of refused) expect(result.reason).toBeInstanceOf(ArchiveVerificationBusyError);
  });

  it('cancels an abandoned pass, closes its handle and verifies again on the next request', async () => {
    const abort = new AbortController();
    let hashingHandle: FileHandle | undefined;
    vi.spyOn(prototype, 'createReadStream').mockImplementationOnce(function (this: FileHandle, options) {
      hashingHandle = this;
      const stream = original.call(this, options);
      stream.once('data', () => abort.abort());
      return stream;
    });
    expect(await verifier.open(path, HASH, abort.signal)).toBeNull();
    expect(hashingHandle?.fd).toBe(-1);
    const next = await verifier.open(path, HASH);
    expect(next).not.toBeNull();
    await next?.close();
    expect(bytesRead).toBe(ARCHIVE.length);
  });

  it('keeps shared verification alive when its first requester disconnects', async () => {
    const abort = new AbortController();
    let started: () => void = () => undefined;
    const hashing = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(prototype, 'createReadStream').mockImplementationOnce(function (this: FileHandle, options) {
      const stream = original.call(this, options);
      stream.once('data', started);
      return stream;
    });
    const first = verifier.open(path, HASH, abort.signal);
    const second = verifier.open(path, HASH);
    await hashing;
    abort.abort();
    expect(await first).toBeNull();
    const handle = await second;
    expect(handle).not.toBeNull();
    try {
      expectArchiveBytes(await handle?.readFile());
    } finally {
      await handle?.close();
    }
  });
});
