import { describe, expect, it } from 'vitest';
import {
  autoSaveName,
  displayNameOf,
  formatPlaytime,
  formatSavedAgo,
  formatSavedAt,
  MAX_SAVE_NAME_LENGTH,
  sanitizedSaveName,
} from '../../../../src/view/runtime/save-load/list-model.js';

/** 12 sim ticks per game second (`TICKS_PER_SECOND`). */
const TICKS_PER_MINUTE = 12 * 60;

const BEL = String.fromCharCode(7);

describe('formatPlaytime', () => {
  it('formats m:ss under an hour and h:mm:ss from there', () => {
    expect(formatPlaytime(0)).toBe('0:00');
    expect(formatPlaytime(11)).toBe('0:00');
    expect(formatPlaytime(12)).toBe('0:01');
    expect(formatPlaytime(TICKS_PER_MINUTE * 61 + 12 * 5)).toBe('1:01:05');
  });
});

describe('formatSavedAt', () => {
  it('renders a dash for an unknown timestamp and a localized stamp otherwise', () => {
    expect(formatSavedAt(null, 'pl')).toBe('-');
    expect(formatSavedAt(Date.UTC(2026, 0, 15, 12, 30), 'pl')).toMatch(/2026/);
  });
});

describe('formatSavedAgo', () => {
  const NOW = Date.UTC(2026, 9, 10, 12, 0);
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;

  it('reads recent saves as time ago and older ones as their date', () => {
    expect(formatSavedAgo(NOW - 20_000, NOW, 'en')).toBe('now');
    expect(formatSavedAgo(NOW - 5 * MINUTE, NOW, 'en')).toBe('5 minutes ago');
    expect(formatSavedAgo(NOW - 3 * HOUR, NOW, 'en')).toBe('3 hours ago');
    expect(formatSavedAgo(NOW - 25 * HOUR, NOW, 'en')).toBe(formatSavedAt(NOW - 25 * HOUR, 'en'));
    expect(formatSavedAgo(null, NOW, 'en')).toBe('-');
  });

  it('reads a save stamped ahead of the clock as just written', () => {
    expect(formatSavedAgo(NOW + MINUTE, NOW, 'en')).toBe('now');
  });
});

describe('sanitizedSaveName', () => {
  it('replaces forbidden filename characters and strips control characters', () => {
    expect(sanitizedSaveName('przed atakiem')).toBe('przed atakiem');
    expect(sanitizedSaveName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizedSaveName(`ok${BEL}name`)).toBe('okname');
  });

  it('trims, caps the length, and refuses an empty result', () => {
    expect(sanitizedSaveName('  x  ')).toBe('x');
    expect(sanitizedSaveName('y'.repeat(200))).toHaveLength(MAX_SAVE_NAME_LENGTH);
    expect(sanitizedSaveName('')).toBeNull();
    expect(sanitizedSaveName('   ')).toBeNull();
    expect(sanitizedSaveName(BEL)).toBeNull();
  });
});

describe('save file suffixes', () => {
  it('strips the three accepted suffixes only', () => {
    expect(displayNameOf('przed atakiem.json.gz')).toBe('przed atakiem');
    expect(displayNameOf('foreign.json')).toBe('foreign');
    expect(displayNameOf('plain')).toBe('plain');
  });
});

describe('autoSaveName', () => {
  it('numbers past the list size and skips taken names', () => {
    expect(autoSaveName('Zapis {n}', [])).toBe('Zapis 1');
    expect(autoSaveName('Zapis {n}', ['Zapis 1', 'przed atakiem'])).toBe('Zapis 3');
    expect(autoSaveName('Zapis {n}', ['Zapis 2'])).toBe('Zapis 3');
  });
});
