import { describe, expect, it } from 'vitest';
import { LANGUAGES, textReadingOrder } from '../src/languages.js';

describe('textReadingOrder', () => {
  it('reads a source language first and then the registry order', () => {
    expect(textReadingOrder('ger')).toEqual(['ger', 'pol', 'eng', 'rus', 'chs', 'cht']);
  });
  it('sends a Chinese reader to English before the mod language', () => {
    expect(textReadingOrder('chs').slice(0, 2)).toEqual(['chs', 'eng']);
    expect(textReadingOrder('cht').slice(0, 3)).toEqual(['cht', 'chs', 'eng']);
  });
  it('lists every language exactly once', () => {
    for (const lang of LANGUAGES) expect([...textReadingOrder(lang)].sort()).toEqual([...LANGUAGES].sort());
  });
});
