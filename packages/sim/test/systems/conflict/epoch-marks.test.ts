import { describe, expect, it } from 'vitest';
import type { Entity } from '../../../src/ecs/world.js';
import { EpochMarks } from '../../../src/systems/conflict/epoch-marks.js';

describe('epoch marks', () => {
  it('holds a mark for its round only, growing past any id', () => {
    const marks = new EpochMarks();
    marks.begin();
    const far = 5000 as Entity;
    expect(marks.firstMark(far)).toBe(true);
    expect(marks.firstMark(far)).toBe(false);
    expect(marks.has(far)).toBe(true);
    expect(marks.has(7 as Entity)).toBe(false);
    marks.begin();
    expect(marks.has(far)).toBe(false);
  });
});
