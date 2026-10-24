import { describe, expect, it } from 'vitest';
import { parseLabArgs } from '../../../bench/net-lab/config.js';

describe('the load lab flags', () => {
  it('refuses a link rate of 0, which would never deliver a byte', () => {
    expect(() => parseLabArgs(['--link', '0=home,up=0'])).toThrow(/--link up must be an integer >= 1/);
    expect(() => parseLabArgs(['--link', '0=home,down=0'])).toThrow(/--link down must be an integer >= 1/);
    expect(parseLabArgs(['--link', '0=home,up=1,latencyMs=0']).links[0]).toMatchObject({
      uploadBytesPerSecond: 1,
      latencyMs: 0,
    });
  });

  it('refuses a difficulty beside a save, whose computers keep their own', () => {
    expect(() => parseLabArgs(['--save', 'world.save.gz', '--difficulty', 'easy'])).toThrow(
      /--difficulty and --save exclude each other/,
    );
    expect(parseLabArgs(['--difficulty', 'easy']).difficulty).toBe('easy');
  });
});
