import { describe, expect, it } from 'vitest';
import { parseRegQuery } from '../../src/original-game/windows-registry.js';

const OUTPUT =
  '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Funatics\\Wonders\r\n    GamePath    REG_SZ    C:\\Program Files (x86)\\Wonders\r\n\r\n';

describe('parseRegQuery', () => {
  it('reads the string data of the asked value', () => {
    expect(parseRegQuery(OUTPUT, 'GamePath')).toBe('C:\\Program Files (x86)\\Wonders');
    expect(parseRegQuery(OUTPUT, 'gamepath')).toBe('C:\\Program Files (x86)\\Wonders');
  });

  it('ignores other values and other types', () => {
    expect(parseRegQuery(OUTPUT, 'FolderPath')).toBeUndefined();
    expect(parseRegQuery('    GamePath    REG_DWORD    0x1\r\n', 'GamePath')).toBeUndefined();
  });
});
