import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** The path segment a production build serves its content tree under, as `/c/<hash>/...`. */
export const CONTENT_PATH_SEGMENT = 'c';

const SHA256_HEX = '[0-9a-f]{64}';
/** A versioned content path: its hash, and the content path it names. */
export const VERSIONED_CONTENT_PATH = new RegExp(`^/${CONTENT_PATH_SEGMENT}/(${SHA256_HEX})(/.*)$`);

/** The served prefix of a content tree with this hash. */
export function contentPrefix(hash: string): string {
  return `/${CONTENT_PATH_SEGMENT}/${hash}`;
}

/** The content path a versioned path names, or the path itself when it carries no content hash. */
export function unversionedContentPath(pathname: string): string {
  return VERSIONED_CONTENT_PATH.exec(pathname)?.[2] ?? pathname;
}

// A name sha256sum would escape breaks the shell check's line format, so it fails the hash instead.
const ESCAPED_BY_SHA256SUM = /[\\\n\r]/;

async function fileSha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/**
 * The hash of every file in `contentRoot`, or null without the tree. It is the sha256 of a manifest
 * with one `<sha256>  ./<path>` line per file, sorted by path bytes: what
 * `find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum` prints in the tree,
 * which `deploy/web/Dockerfile` reruns over the content it ships.
 */
export async function contentTreeHash(contentRoot: string): Promise<string | null> {
  if (!existsSync(contentRoot)) return null;
  const paths: Buffer[] = [];
  for (const entry of readdirSync(contentRoot, { recursive: true, withFileTypes: true })) {
    const path = relative(contentRoot, join(entry.parentPath, entry.name)).replaceAll('\\', '/');
    // Servers follow a symlink that `find -type f` skips, so it would serve unhashed bytes.
    if (entry.isSymbolicLink()) throw new Error(`content must not hold a symlink: ${path}`);
    if (!entry.isFile()) continue;
    if (ESCAPED_BY_SHA256SUM.test(path)) throw new Error(`content file name cannot be hashed: ${path}`);
    paths.push(Buffer.from(`./${path}`));
  }
  paths.sort(Buffer.compare);
  const manifest = createHash('sha256');
  for (const path of paths) {
    const digest = await fileSha256(join(contentRoot, path.toString()));
    manifest.update(`${digest}  ${path.toString()}\n`);
  }
  return manifest.digest('hex');
}
