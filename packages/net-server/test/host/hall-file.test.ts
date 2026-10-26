import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HALL_SAVE_DELAY_MS, hallFile } from '../../src/host/hall-file.js';
import { HALL_RECORD_VERSION, type HallRecord } from '../../src/relay/hall/record.js';

const RECORD: HallRecord = {
  version: HALL_RECORD_VERSION,
  chat: [{ from: 'Ania', text: 'hej', at: 1 }],
  seen: [{ nick: 'Ania', at: 2 }],
};

describe('hall file', () => {
  const dirs: string[] = [];
  const path = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'on-hall-'));
    dirs.push(dir);
    return join(dir, 'hall.json');
  };
  afterEach(() => {
    vi.useRealTimers();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('starts empty without a file, writes a change after its delay, and reads it back', async () => {
    vi.useFakeTimers();
    const file = path();
    const kept = hallFile(
      file,
      () => RECORD,
      () => undefined,
    );
    expect(kept.initial).toBeNull();
    kept.changed();
    kept.changed();
    expect(existsSync(file)).toBe(false);
    await vi.advanceTimersByTimeAsync(HALL_SAVE_DELAY_MS);
    vi.useRealTimers();
    await vi.waitFor(() => expect(existsSync(file)).toBe(true));
    expect(
      hallFile(
        file,
        () => RECORD,
        () => undefined,
      ).initial,
    ).toEqual(RECORD);
  });

  it('writes at once on flush', async () => {
    const file = path();
    await hallFile(
      file,
      () => RECORD,
      () => undefined,
    ).flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(RECORD);
  });

  it('keeps what the stop flushed over a save still in flight', async () => {
    vi.useFakeTimers();
    const file = path();
    let record: HallRecord = { ...RECORD, chat: [] };
    const kept = hallFile(
      file,
      () => record,
      () => undefined,
    );
    kept.changed();
    await vi.advanceTimersByTimeAsync(HALL_SAVE_DELAY_MS);
    record = RECORD;
    const flushed = kept.flush();
    kept.changed();
    vi.useRealTimers();
    await flushed;
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(RECORD);
  });

  it('sets aside a file it cannot read', () => {
    const file = path();
    writeFileSync(file, JSON.stringify({ ...RECORD, version: HALL_RECORD_VERSION + 1 }));
    const log = vi.fn();
    expect(hallFile(file, () => RECORD, log).initial).toBeNull();
    expect(log).toHaveBeenCalledWith('hall rejected', expect.objectContaining({ path: file }));
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.rejected`)).toBe(true);
  });
});
