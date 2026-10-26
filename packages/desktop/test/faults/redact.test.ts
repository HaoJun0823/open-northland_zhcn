import { describe, expect, it } from 'vitest';
import { redactHome } from '../../src/faults/redact.js';

describe('redactHome', () => {
  it('replaces the home directory in paths, file URLs and encoded paths, and only whole segments', () => {
    expect(redactHome('at f (/Users/ann/game/main.cjs:3:4)', '/Users/ann')).toBe(
      'at f (~/game/main.cjs:3:4)',
    );
    expect(redactHome('/Users/ann', '/Users/ann/')).toBe('~');
    expect(redactHome('/Users/annabel/x and /USERS/ANN/y', '/Users/ann')).toBe('/Users/annabel/x and ~/y');
    expect(
      redactHome(
        String.raw`C:\Users\Ann Lee\a.js and file:///C:/Users/Ann%20Lee/b.js`,
        String.raw`C:\Users\Ann Lee`,
      ),
    ).toBe(String.raw`~\a.js and file:///~/b.js`);
  });

  it('leaves text alone for an empty or root home', () => {
    expect(redactHome('/etc/hosts', '/')).toBe('/etc/hosts');
    expect(redactHome('/etc/hosts', '')).toBe('/etc/hosts');
  });
});
