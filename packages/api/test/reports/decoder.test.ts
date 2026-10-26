import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { type DecoderOptions, ProcessReportDecoder } from '../../src/reports/decoder.js';
import { IntakeError } from '../../src/reports/intake.js';
import { addendum, REPORT_ID, wire } from '../support/report-fixture.js';

/** The compiled child: vitest runs the sources, a child process needs JavaScript. */
const DECODE_PROCESS = new URL('../../dist/reports/decode-process.js', import.meta.url);
const DIES_WHEN_IDLE = new URL('../support/decode-then-die.mjs', import.meta.url);
/** Long against the waits below, so a decode that settles at all settles well before it. */
const LONG_DEADLINE_MS = 5000;
const IDLE_DEATH_WAIT_MS = 200;
const INFLATED_CAP = 1 << 24;
/** Far too small a heap for the heavy body below, ample for a plain addendum. */
const SMALL_HEAP_MB = 16;
const HEAVY_VALUES = 1_000_000;

const reasonOf = (failure: unknown): string =>
  failure instanceof IntakeError ? failure.reason : `unexpected ${String(failure)}`;

describe('ProcessReportDecoder', () => {
  const decoders: ProcessReportDecoder[] = [];
  afterEach(() => {
    for (const decoder of decoders.splice(0)) decoder.close();
  });
  const open = (options: DecoderOptions) => {
    const decoder = new ProcessReportDecoder({ script: DECODE_PROCESS, ...options });
    decoders.push(decoder);
    return decoder;
  };

  it('refuses an upload that exhausts its heap and decodes the next one in a new process', async () => {
    const decoder = open({ heapMb: SMALL_HEAP_MB });
    const heavy = JSON.stringify(addendum({ attachments: { settings: 0 } })).replace(
      '"settings":0',
      `"settings":[${Array(HEAVY_VALUES).fill(0)}]`,
    );
    const refused = decoder.decode(gzipSync(heavy), 'addendum', INFLATED_CAP);
    const next = decoder.decode(wire(addendum({ comment: 'after' })), 'addendum', INFLATED_CAP);
    expect(reasonOf(await refused.catch((failure: unknown) => failure))).toBe('too-complex');
    expect(await next).toMatchObject({ part: 'addendum', id: REPORT_ID, comment: 'after' });
  });

  it('kills a decode past its deadline', async () => {
    const decoder = open({ timeoutMs: 1 });
    const late = decoder.decode(wire(addendum()), 'addendum', INFLATED_CAP);
    expect(reasonOf(await late.catch((failure: unknown) => failure))).toBe('too-complex');
  });

  it('starts a new process after the idle one was killed', async () => {
    const decoder = open({ script: DIES_WHEN_IDLE, timeoutMs: LONG_DEADLINE_MS });
    const started = Date.now();
    for (const attempt of ['first', 'after the kill']) {
      const reply = decoder.decode(wire(addendum()), 'addendum', INFLATED_CAP);
      expect(reasonOf(await reply.catch((failure: unknown) => failure)), attempt).toBe('invalid');
      await new Promise((resolve) => setTimeout(resolve, IDLE_DEATH_WAIT_MS));
    }
    expect(Date.now() - started).toBeLessThan(LONG_DEADLINE_MS);
  });

  it('fails each decode at once and reports the fault while the process cannot start', async () => {
    const decoder = open({ execPath: '/nonexistent/node', timeoutMs: LONG_DEADLINE_MS });
    const started = Date.now();
    for (const attempt of ['first', 'second']) {
      const failure = await decoder
        .decode(wire(addendum()), 'addendum', INFLATED_CAP)
        .catch((error: unknown) => error);
      expect(failure, attempt).toBeInstanceOf(Error);
      expect(failure, attempt).not.toBeInstanceOf(IntakeError);
    }
    expect(Date.now() - started).toBeLessThan(LONG_DEADLINE_MS);
    expect(decoder.failing()).toBe(true);
  });
});
