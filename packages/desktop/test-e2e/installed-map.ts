import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MAP_FILE_SUFFIXES } from '../../app/src/content/map-source/files.js';
import { INSTALLED_MAP_RECORD_VERSION } from '../../app/src/content/map-source/installed.js';
import { IR_VERSION } from '../../data/src/schema/content/ir-version.js';
import { MapsIndexEntry } from '../../data/src/schema/maps/listing.js';

/** An installed copy, so the boot check cannot accidentally read the shipped map's static URL. */
export async function installedMapFixture(content: string) {
  const originalId = 'magiczny_las';
  const mapId = 'catalogue-persistence-probe';
  const entries = MapsIndexEntry.array().parse(
    JSON.parse(await readFile(join(content, 'maps-index.json'), 'utf8')),
  );
  const original = entries.find((entry) => entry.id === originalId);
  if (original === undefined) throw new Error('Missing installed-map test input');
  const files: [string, number][] = [];
  for (const suffix of MAP_FILE_SUFFIXES) {
    try {
      files.push([suffix, (await stat(join(content, 'maps', `${originalId}${suffix}`))).size]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return {
    record: {
      version: INSTALLED_MAP_RECORD_VERSION,
      revision: randomUUID(),
      mapId,
      entryId: mapId,
      fingerprint: original.fingerprint,
      irVersion: IR_VERSION,
      index: { ...original, id: mapId, minimap: false, provenance: { kind: 'catalog', folder: originalId } },
      installedAt: Date.now(),
      size: files.reduce((bytes, [, file]) => bytes + file, 0),
      suffixes: files.map(([suffix]) => suffix),
    },
    originalId,
  };
}
