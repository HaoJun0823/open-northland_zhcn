import { describe, expect, it } from 'vitest';
import { formatInfoLine, goalProgressTexts, infoLineTexts } from '../src/game/info-lines.js';

describe('goalProgressTexts', () => {
  it('names each row and prints have over need, falling back to the good id', () => {
    const naming = {
      good: (id: number) => (id === 1 ? 'Wood' : undefined),
      inhabitants: 'People',
      soldiers: 'Men',
    };
    expect(
      goalProgressTexts(
        [
          { kind: 'goods', good: 1, have: 3, need: 50 },
          { kind: 'goods', good: 9, have: 0, need: 2 },
          { kind: 'inhabitants', soldiers: false, have: 4, need: 10 },
          { kind: 'inhabitants', soldiers: true, have: 1, need: 5 },
        ],
        naming,
      ),
    ).toEqual(['Wood 3/50', '#9 0/2', 'People 4/10', 'Men 1/5']);
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
      infoLineTexts(
        [
          { index: 0, stringId: 1, count: 0, extra: 0 },
          { index: 2, stringId: 2, count: 4, extra: 0 },
        ],
        (id) => texts[id],
      ),
    ).toEqual(['one', 'two 4']);
  });
});
