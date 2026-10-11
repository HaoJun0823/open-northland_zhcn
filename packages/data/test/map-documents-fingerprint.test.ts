import { describe, expect, it } from 'vitest';
import { mapDocumentsFingerprint } from '../src/index.js';

const MAP = { width: 1, height: 1, typeIds: [0], entities: [{ verb: 'sethouse', x: 1, y: 2 }] };
const scriptFrom = (file: string) => ({
  players: [],
  ai: [{ conditions: [{ kind: 'onConditionChangeDelayed', slot: 1, source: 2 }] }],
  source: { file, block: 'players', layer: 'mod' },
});

describe('mapDocumentsFingerprint', () => {
  it('ignores where the script was read from', () => {
    expect(mapDocumentsFingerprint({ map: MAP, script: scriptFrom('CnModMaps/wyspa/map.cif') })).toBe(
      mapDocumentsFingerprint({ map: MAP, script: scriptFrom('wyspa/map.cif') }),
    );
  });

  it('changes with an entity', () => {
    const moved = { ...MAP, entities: [{ verb: 'sethouse', x: 1, y: 3 }] };
    const script = scriptFrom('wyspa/map.cif');
    expect(mapDocumentsFingerprint({ map: moved, script })).not.toBe(
      mapDocumentsFingerprint({ map: MAP, script }),
    );
  });

  it('keeps a numeric source, which is a condition slot', () => {
    const script = scriptFrom('wyspa/map.cif');
    const other = {
      ...script,
      ai: [{ conditions: [{ kind: 'onConditionChangeDelayed', slot: 1, source: 3 }] }],
    };
    expect(mapDocumentsFingerprint({ map: MAP, script: other })).not.toBe(
      mapDocumentsFingerprint({ map: MAP, script }),
    );
  });

  it('hashes a map without a script', () => {
    expect(mapDocumentsFingerprint({ map: MAP, script: null })).toMatch(/^[a-f0-9]{64}$/);
  });
});
