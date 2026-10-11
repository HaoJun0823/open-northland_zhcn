import { Catalog } from '@open-northland/data';
import { IR_VERSION } from '@open-northland/data/ir-version';
import { describe, expect, it } from 'vitest';
import { mockCatalogue } from './support/mock-catalogue-api.js';

describe('the mock catalogue API', () => {
  it('serves entries the catalogue schema reads, and a new conversion on republish', () => {
    const mock = mockCatalogue({ irVersion: IR_VERSION, contentDir: null });
    expect(Catalog.parse(mock.entries)).toHaveLength(mock.entries.length);
    const fingerprint = () => {
      const entry = mock.entries.find((item) => item.id === 'cn-burza');
      return entry?.conversion?.verdict === 'ok' ? entry.conversion.maps[0]?.fingerprint : undefined;
    };
    const before = fingerprint();
    expect(mock.sidecar(IR_VERSION, 'cn-burza', '.json')).not.toBeNull();
    expect(mock.republish('cn-burza')).toBe(true);
    expect(fingerprint()).not.toBe(before);
    expect(mock.sidecar(IR_VERSION + 1, 'cn-burza', '.json')).toBeNull();
  });
});
