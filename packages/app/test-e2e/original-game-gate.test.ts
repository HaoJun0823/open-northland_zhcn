import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page } from 'playwright';
import type { ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { libraryHead } from '../../ownership/test/memory-reader.js';

/** The browser build's original-game gate, in Chromium over the app's dev server. */

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_KEY = 'open-northland.settings';
/** The dev server checks only when the URL asks; a release build always does. */
const MENU_QUERY = '?lang=eng&sound=off&fullscreen=off&originalGameCheck';
/** A cold dev server transforms the whole menu on the first load. */
const SCREEN_TIMEOUT_MS = 90_000;

let server: ViteDevServer | undefined;
let browser: Browser | undefined;
let origin = '';
let folders = '';

/** A port the OS just handed out, so the server never takes the primary checkout's default one. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address !== null
          ? resolvePort(address.port)
          : reject(new Error('the port probe reported no TCP port')),
      );
    });
  });
}

beforeAll(async () => {
  const { createServer } = await import('vite');
  // localhost can resolve to another checkout's listener on the same port.
  server = await createServer({
    root: APP_ROOT,
    server: { host: '127.0.0.1', port: await freePort(), strictPort: true, open: false },
    logLevel: 'warn',
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('the app dev server reported no TCP port');
  }
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ args: ['--mute-audio'] });
  folders = await mkdtemp(join(tmpdir(), 'northland-gate-'));
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (folders !== '') await rm(folders, { recursive: true, force: true });
});

async function freshPage(verified: boolean): Promise<Page> {
  if (browser === undefined) throw new Error('the browser did not launch');
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (verified) {
    await context.addInitScript((key) => {
      window.localStorage.setItem(key, JSON.stringify({ originalGameVerified: true }));
    }, SETTINGS_KEY);
  }
  return context.newPage();
}

async function storedFlag(page: Page): Promise<unknown> {
  return page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) ?? '{}').originalGameVerified,
    SETTINGS_KEY,
  );
}

describe('original-game gate', () => {
  it('asks an unverified visitor for the game folder and opens the menu once one is recognized', async () => {
    const empty = join(folders, 'Photos');
    await mkdir(empty, { recursive: true });
    await writeFile(join(empty, 'beach.jpg'), new Uint8Array(8));
    const install = join(folders, 'Cultures');
    await mkdir(join(install, 'DataX', 'Libs'), { recursive: true });
    await writeFile(join(install, 'DataX', 'Libs', 'data0001.lib'), libraryHead());

    const page = await freshPage(false);
    await page.goto(`${origin}/${MENU_QUERY}`, { waitUntil: 'commit' });
    const gate = page.locator('.main-menu__gate');
    await gate.waitFor({ timeout: SCREEN_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: 'Pick the game folder' }).isVisible()).resolves.toBe(true);
    expect(await page.locator('.main-menu__nav').count()).toBe(0);

    const input = page.locator('.main-menu__gate-input');
    await input.setInputFiles(empty);
    await page.getByText('That folder holds no Cultures game data').waitFor();
    expect(await storedFlag(page)).toBeUndefined();

    await input.setInputFiles(install);
    await page.locator('.main-menu__nav').waitFor();
    expect(await gate.count()).toBe(0);
    expect(await storedFlag(page)).toBe(true);
    await page.context().close();
  });

  it('sends an unverified game link to the menu gate', async () => {
    const page = await freshPage(false);
    await page.goto(
      `${origin}/?map=magiczny_las&player=0&lang=eng&sound=off&fullscreen=off&originalGameCheck`,
      {
        waitUntil: 'commit',
      },
    );
    await page.locator('.main-menu__gate').waitFor({ timeout: SCREEN_TIMEOUT_MS });
    expect(new URL(page.url()).searchParams.has('map')).toBe(false);
    await page.context().close();
  });

  it('goes straight to the menu once the check passed', async () => {
    const page = await freshPage(true);
    await page.goto(`${origin}/${MENU_QUERY}`, { waitUntil: 'commit' });
    await page.locator('.main-menu__nav').waitFor({ timeout: SCREEN_TIMEOUT_MS });
    expect(await page.locator('.main-menu__gate').count()).toBe(0);
    await page.context().close();
  });
});
