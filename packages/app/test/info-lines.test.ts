import { describe, expect, it } from 'vitest';
import { formatInfoLine, goalProgressRows, infoLineRows } from '../src/game/info-lines.js';

describe('goalProgressRows', () => {
  it('names each row and prints have over need, falling back to the good id', () => {
    const naming = {
      good: (id: number) => (id === 1 ? 'Wood' : undefined),
      inhabitants: 'People',
      soldiers: 'Men',
    };
    expect(
      goalProgressRows(
        [
          { kind: 'goods', good: 1, have: 3, need: 50 },
          { kind: 'goods', good: 9, have: 0, need: 2 },
          { kind: 'inhabitants', soldiers: false, have: 4, need: 10 },
          { kind: 'inhabitants', soldiers: true, have: 1, need: 5 },
        ],
        naming,
      ),
    ).toEqual([
      { kind: 'progress', label: 'Wood', have: 3, need: 50 },
      { kind: 'progress', label: '#9', have: 0, need: 2 },
      { kind: 'progress', label: 'People', have: 4, need: 10 },
      { kind: 'progress', label: 'Men', have: 1, need: 5 },
    ]);
  });
});

describe('formatInfoLine', () => {
  it('prints the count into the first %d and the extra into the second, leaving the rest alone', () => {
    const line = { index: 0, stringId: 11, count: 3, extra: 8 };
    expect(formatInfoLine('Settlers at the ford: %d of %d', line)).toBe('Settlers at the ford: 3 of 8');
    expect(formatInfoLine('Only %d here', line)).toBe('Only 3 here');
    expect(formatInfoLine('Nothing to fill', line)).toBe('Nothing to fill');
    expect(formatInfoLine('%d/%d/%d', line)).toBe('3/8/%d');
  });

  it('prints a zero for a plain string and the id for a string the map lacks', () => {
    expect(formatInfoLine('%d warriors', { index: 0, stringId: 5, count: 0, extra: 0 })).toBe('0 warriors');
    expect(formatInfoLine(undefined, { index: 0, stringId: 5, count: 0, extra: 0 })).toBe('#5');
  });

  it('lists the lines in the order given', () => {
    const texts: Record<number, string> = { 1: 'one', 2: 'two %d' };
    expect(
      infoLineRows(
        [
          { index: 0, stringId: 1, count: 0, extra: 0 },
          { index: 2, stringId: 2, count: 4, extra: 0 },
        ],
        (id) => texts[id],
      ),
    ).toEqual([
      { kind: 'text', text: 'one' },
      { kind: 'text', text: 'two 4' },
    ]);
  });
});

describe('script progress templates', () => {
  const line = { index: 0, stringId: 901, count: 3, extra: 10 };
  it('uses an explicit trailing ratio, including a dynamic target', () => {
    for (const template of ['Diamonds: %d/10', 'Diamonds: %d / %d']) {
      expect(infoLineRows([line], () => template)).toEqual([
        { kind: 'progress', label: 'Diamonds', have: 3, need: 10 },
      ]);
    }
  });
  it('keeps prose, missing strings and invalid targets intact', () => {
    for (const template of [
      'Held: %d of %d',
      'Time 3/10',
      'Diamonds %d/0',
      'At %d: diamonds %d/10',
      undefined,
    ]) {
      expect(infoLineRows([line], () => template)).toEqual([
        { kind: 'text', text: formatInfoLine(template, line) },
      ]);
    }
  });
});
