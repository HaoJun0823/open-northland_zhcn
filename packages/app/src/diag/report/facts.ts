/** The page's own facts for a report: the build, the browser and machine, and how the page was opened. */
import type { ReportBuild, ReportEnvironment } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { GAME_VERSION } from '../../build-version.js';
import { CONTENT_PREFIX } from '../../content/url.js';
import { bcp47Tag } from '../../i18n/index.js';
import { routeFor } from '../../routes.js';
import { detectedWebglInfo } from '../../view/graphics/hardware.js';
import { answeredWithin } from '../bundle.js';
import { heapMb } from '../heap.js';
import { type RedactedRoute, redactRouteParams } from './redact.js';

declare const __CLIENT_BUILD__: string;

/** The desktop shell answers over IPC; a wedged shell must not hold the report. */
const DESKTOP_ANSWER_TIMEOUT_MS = 1000;
const TEXT_CHARS = 512;
const VERSION_KEY_CHARS = 64;
const MAX_LANGUAGES = 16;
const LANGUAGE_CHARS = 64;
/** The schema's bound on a BCP-47 tag of the game's own languages. */
const UI_LANGUAGE_CHARS = 16;

const clip = (text: string, max = TEXT_CHARS): string => text.slice(0, max);
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const whole = (value: number): number => Math.max(0, Math.round(value));

export async function buildFacts(): Promise<ReportBuild> {
  const faults = window.desktop?.faults;
  const versions =
    faults === undefined ? null : await answeredWithin(faults.versions(), DESKTOP_ANSWER_TIMEOUT_MS);
  const desktop =
    versions === null
      ? undefined
      : Object.fromEntries(
          Object.entries(versions).map(([key, value]) => [clip(key, VERSION_KEY_CHARS), clip(String(value))]),
        );
  return {
    version: clip(GAME_VERSION),
    client: typeof __CLIENT_BUILD__ === 'string' ? clip(__CLIENT_BUILD__) : null,
    content: CONTENT_PREFIX === '' ? null : clip(CONTENT_PREFIX),
    irVersion: IR_VERSION,
    shell: window.desktop === undefined ? 'web' : 'desktop',
    ...(desktop !== undefined ? { desktop } : {}),
  };
}

function timeZone(): string | null {
  try {
    return clip(Intl.DateTimeFormat().resolvedOptions().timeZone, LANGUAGE_CHARS);
  } catch {
    return null;
  }
}

export function environmentFacts(): ReportEnvironment {
  const gpu = detectedWebglInfo();
  const memory = (navigator as { deviceMemory?: unknown }).deviceMemory;
  return {
    userAgent: clip(navigator.userAgent),
    languages: [...(navigator.languages ?? [])]
      .slice(0, MAX_LANGUAGES)
      .map((tag) => clip(tag, LANGUAGE_CHARS)),
    uiLanguage: clip(bcp47Tag(), UI_LANGUAGE_CHARS),
    timeZone: timeZone(),
    hardwareConcurrency: count(navigator.hardwareConcurrency),
    deviceMemoryGb: typeof memory === 'number' && memory >= 0 ? memory : null,
    screen: {
      width: whole(window.screen.width),
      height: whole(window.screen.height),
      devicePixelRatio: window.devicePixelRatio > 0 ? window.devicePixelRatio : 1,
    },
    viewport: { width: whole(window.innerWidth), height: whole(window.innerHeight) },
    gpu: { vendor: gpu?.vendor ?? null, renderer: gpu?.renderer ?? null, webgl: gpu?.webgl ?? null },
    heapMb: heapMb(),
    uptimeMs: whole(performance.now()),
    online: navigator.onLine,
  };
}

export interface RouteFacts extends RedactedRoute {
  readonly entry: string;
}

export function routeFacts(search: string = window.location.search): RouteFacts {
  const params = new URLSearchParams(search);
  return { entry: routeFor(params).id, ...redactRouteParams(params) };
}
