/**
 * Runs a built web image on a read-only root and checks its caching contract: content under the
 * build's `/c/<hash>/` prefix is immutable, precompressed and only that tree, another hash is sent
 * to the bare path uncached, and the bare paths, the page and `version.json` revalidate. A
 * revalidated hashed file stays immutable and a miss anywhere is not cached.
 *
 * Usage: node deploy/web/smoke-image.mjs [image reference]
 */

import { request } from 'node:http';

import { docker, finish, freePort, waitForHealth } from '../../scripts/smoke-image-support.mjs';

const image = process.argv[2] ?? 'open-northland-web';

const WEB_PORT = 80;
const HTTP_OK = 200;
const HTTP_PARTIAL_CONTENT = 206;
const HTTP_FOUND = 302;
const HTTP_NOT_MODIFIED = 304;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_REQUEST = 400;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const IMMUTABLE = /\bimmutable\b/;
const NO_CACHE = 'no-cache';
const NO_STORE = 'no-store';
const FIRST_BYTES = 'bytes=0-15';
const CONTENT_ROOT = '/srv/content';

const results = [];
function check(name, ok, detail) {
  results.push(ok);
  console.log(ok ? `  ok   ${name}` : ` FAIL  ${name}\n         ${detail ?? ''}`);
}

const describe = (response) => `${response.status} cache-control: ${response.headers.get('cache-control')}`;

/** A content file's URL path below the content root, each segment percent-encoded. */
const contentUrlPath = (file) => file.slice(CONTENT_ROOT.length).split('/').map(encodeURIComponent).join('/');

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const container = docker(
  'run',
  '--detach',
  '--read-only',
  '--tmpfs',
  '/tmp',
  '--publish',
  `127.0.0.1:${port}:${WEB_PORT}`,
  image,
);
let passed = false;
try {
  await waitForHealth(base, image);
  const get = (path, init) => fetch(`${base}${path}`, { redirect: 'manual', ...init });
  // fetch resolves dot segments and backslashes before sending; these probes need the raw line.
  const getRaw = (path) =>
    new Promise((resolve, reject) => {
      request({ host: '127.0.0.1', port, path }, (response) => {
        response.resume();
        resolve({ status: response.statusCode, location: response.headers.location });
      })
        .on('error', reject)
        .end();
    });
  const findContent = (filter) =>
    docker('exec', container, 'sh', '-c', `find ${CONTENT_ROOT} -type f ${filter} | head -n 1`);

  const versionResponse = await get('/version.json');
  const version = await versionResponse.json();
  check(
    'version.json names the content hash',
    SHA256_HEX.test(version.content ?? ''),
    JSON.stringify(version),
  );
  check(
    'version.json revalidates',
    versionResponse.headers.get('cache-control') === NO_CACHE,
    describe(versionResponse),
  );
  const page = await get('/');
  check(
    'the page revalidates',
    page.status === HTTP_OK && page.headers.get('cache-control') === NO_CACHE,
    describe(page),
  );

  const prefix = `/c/${version.content}`;
  const ir = await get(`${prefix}/ir.json`, { headers: { 'accept-encoding': 'gzip' } });
  check(
    'versioned content is immutable',
    ir.status === HTTP_OK && IMMUTABLE.test(ir.headers.get('cache-control') ?? ''),
    describe(ir),
  );
  check(
    'versioned json is served precompressed',
    ir.headers.get('content-encoding') === 'gzip' && ir.headers.get('content-type') === 'application/json',
    `${ir.headers.get('content-encoding')} ${ir.headers.get('content-type')}`,
  );
  const irAgain = await get(`${prefix}/ir.json`, {
    headers: { 'accept-encoding': 'gzip', 'if-none-match': ir.headers.get('etag') ?? '' },
  });
  check(
    'a revalidated versioned file stays immutable',
    irAgain.status === HTTP_NOT_MODIFIED && IMMUTABLE.test(irAgain.headers.get('cache-control') ?? ''),
    describe(irAgain),
  );
  const spacedFlac = findContent("-name '*.flac' -name '* *'");
  const anyFlac = spacedFlac || findContent("-name '*.flac'");
  if (anyFlac) {
    const flac = await get(`${prefix}${contentUrlPath(anyFlac)}`, { headers: { range: FIRST_BYTES } });
    check(
      'flac is served as audio/flac',
      flac.status === HTTP_PARTIAL_CONTENT && flac.headers.get('content-type') === 'audio/flac',
      `${describe(flac)} content-type: ${flac.headers.get('content-type')}`,
    );
  } else {
    console.log('  skip flac is served as audio/flac: the content holds no .flac');
  }
  const mediaPath = contentUrlPath(findContent("! -name '*.json' ! -name '*.gz'"));
  const range = await get(`${prefix}${mediaPath}`, { headers: { range: FIRST_BYTES } });
  check(
    `a versioned range of ${mediaPath} is immutable`,
    range.status === HTTP_PARTIAL_CONTENT && IMMUTABLE.test(range.headers.get('cache-control') ?? ''),
    describe(range),
  );
  const missing = await get(`${prefix}/no-such-file.json`);
  check(
    'a versioned miss is not cached',
    missing.status === HTTP_NOT_FOUND && missing.headers.get('cache-control') === NO_CACHE,
    describe(missing),
  );
  const app = await get(`${prefix}/index.html`);
  check('the app is not under the prefix', app.status === HTTP_NOT_FOUND, describe(app));

  const bare = await get('/ir.json');
  check(
    'bare content revalidates',
    bare.status === HTTP_OK && bare.headers.get('cache-control') === NO_CACHE,
    describe(bare),
  );
  const otherHash = version.content.replace(/^./, (digit) => (digit === '0' ? '1' : '0'));
  const other = await get(`/c/${otherHash}/ir.json?x=1`);
  check(
    "another build's hash goes to the bare path uncached",
    other.status === HTTP_FOUND &&
      other.headers.get('location') === '/ir.json?x=1' &&
      other.headers.get('cache-control') === NO_STORE,
    `${describe(other)} location: ${other.headers.get('location')}`,
  );
  const followed = await get(other.headers.get('location') ?? '');
  check(
    'the redirect lands on the bare file, which revalidates',
    followed.status === HTTP_OK && followed.headers.get('cache-control') === NO_CACHE,
    describe(followed),
  );
  if (spacedFlac) {
    const spacedPath = contentUrlPath(spacedFlac);
    const spaced = await get(`/c/${otherHash}${spacedPath}`);
    const spacedFollowed = await get(spaced.headers.get('location') ?? '', {
      headers: { range: FIRST_BYTES },
    });
    check(
      "another build's hash keeps the request's encoding in the redirect",
      spaced.status === HTTP_FOUND &&
        spaced.headers.get('location') === spacedPath &&
        spacedFollowed.status === HTTP_PARTIAL_CONTENT,
      `${describe(spaced)} location: ${spaced.headers.get('location')}, followed: ${describe(spacedFollowed)}`,
    );
  } else {
    console.log(
      "  skip another build's hash keeps the request's encoding: the content holds no spaced .flac",
    );
  }
  const doubled = await getRaw(`/c/${otherHash}//evil.example/ir.json`);
  check(
    "a doubled slash after another build's hash redirects to a same-origin path",
    doubled.status === HTTP_FOUND && doubled.location === '/evil.example/ir.json',
    `${doubled.status} location: ${doubled.location}`,
  );
  const backslash = await getRaw(`/c/${otherHash}/\\evil.example/ir.json`);
  check(
    "a backslash after another build's hash is not redirected",
    backslash.status === HTTP_NOT_FOUND || backslash.status === HTTP_BAD_REQUEST,
    `${backslash.status} location: ${backslash.location}`,
  );
  for (const dots of ['..', '%2e%2e', '%2E.']) {
    const dotted = await getRaw(`/c/${otherHash}/${dots}/version.json`);
    check(
      `a ${dots} segment after another build's hash is not redirected`,
      dotted.status === HTTP_NOT_FOUND || dotted.status === HTTP_BAD_REQUEST,
      `${dotted.status} location: ${dotted.location}`,
    );
  }
  const entry = await get(version.build);
  check(
    'the entry script is immutable',
    IMMUTABLE.test(entry.headers.get('cache-control') ?? ''),
    describe(entry),
  );
  const entryAgain = await get(version.build, {
    headers: { 'if-none-match': entry.headers.get('etag') ?? '' },
  });
  check(
    'a revalidated entry script stays immutable',
    entryAgain.status === HTTP_NOT_MODIFIED && IMMUTABLE.test(entryAgain.headers.get('cache-control') ?? ''),
    describe(entryAgain),
  );
  const missingAsset = await get('/assets/no-such-file.js');
  check(
    'a missing app file is not cached',
    missingAsset.status === HTTP_NOT_FOUND && missingAsset.headers.get('cache-control') === NO_CACHE,
    describe(missingAsset),
  );
  passed = results.every(Boolean);
} finally {
  if (!passed) console.log(docker('logs', container));
  docker('rm', '--force', container);
}

finish(image, passed);
