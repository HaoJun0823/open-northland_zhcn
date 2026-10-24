import { describe, expect, it } from 'vitest';
import { debugFlags, setDebugFlag } from '../src/diag/debug-flags.js';

/** `?debug=` is a set: turning one mode on or off never touches the others. */

describe('debugFlags', () => {
  it('reads several flags from one param', () => {
    expect([...debugFlags(new URLSearchParams('?debug=profile,trace'))]).toEqual(['profile', 'trace']);
  });

  it('tolerates spacing and empty entries', () => {
    expect([...debugFlags(new URLSearchParams('?debug=profile, ,trace '))]).toEqual(['profile', 'trace']);
  });
});

describe('setDebugFlag', () => {
  it('adds a flag without clobbering its siblings', () => {
    const params = new URLSearchParams('?debug=profile,trace');
    setDebugFlag(params, 'geometry', true);
    expect(debugFlags(params)).toEqual(new Set(['profile', 'trace', 'geometry']));
  });

  it('removes one flag and leaves the rest running', () => {
    const params = new URLSearchParams('?debug=profile,geometry');
    setDebugFlag(params, 'geometry', false);
    expect(params.get('debug')).toBe('profile');
  });

  it('drops the param entirely once nothing is left, so no empty ?debug= lingers', () => {
    const params = new URLSearchParams('?debug=geometry');
    setDebugFlag(params, 'geometry', false);
    expect(params.has('debug')).toBe(false);
  });
});
