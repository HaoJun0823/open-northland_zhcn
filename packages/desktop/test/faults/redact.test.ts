import { describe, expect, it } from 'vitest';
import { redactHome } from '../../src/faults/redact.js';

describe('redactHome', () => {
  it('replaces the home directory in paths, file URLs and encoded paths, and only whole segments', () => {
    expect(redactHome('at f (/Users/ann/game/main.cjs:3:4)', '/Users/ann')).toBe(
      'at f (~/game/main.cjs:3:4)',
    );
    expect(redactHome('/Users/ann', '/Users/ann/')).toBe('~');
    expect(redactHome('/srv/annabel/x and /SRV/ANN/y', '/srv/ann')).toBe('/srv/annabel/x and ~/y');
    expect(
      redactHome(
        String.raw`C:\Users\Ann Lee\a.js and file:///C:/Users/Ann%20Lee/b.js`,
        String.raw`C:\Users\Ann Lee`,
      ),
    ).toBe(String.raw`~\a.js and file:///~/b.js`);
  });

  it('replaces any home folder under the usual parents, such as a Windows short name', () => {
    expect(
      redactHome(
        String.raw`at f (C:\Users\ANNLEE~1\AppData\a.js:1:2) file:///c:/users/ANNLEE~1/b.js`,
        String.raw`C:\Users\Ann Lee`,
      ),
    ).toBe(String.raw`at f (~\AppData\a.js:1:2) file:///~/b.js`);
    expect(redactHome('/home/ann/x /Users/bob', '')).toBe('~/x ~');
  });

  it('leaves text alone for an empty or root home', () => {
    expect(redactHome('/etc/hosts', '/')).toBe('/etc/hosts');
    expect(redactHome('/etc/hosts', '')).toBe('/etc/hosts');
  });
});
