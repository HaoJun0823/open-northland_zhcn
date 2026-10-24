import type { MapBriefing } from '@open-northland/data';
import { afterEach, expect, it, vi } from 'vitest';
import * as guiGfx from '../../../src/content/gui/gfx.js';
import { mapBriefingPictures } from '../../../src/content/map-source/briefing-pictures.js';
import * as mapSources from '../../../src/content/map-source/sources.js';
import { catalogEntry } from '../../support/catalog-maps.js';

afterEach(() => vi.restoreAllMocks());

it('resolves installed catalogue pictures to owned blob URLs and releases them with the presentation', async () => {
  const entry = catalogEntry('cn-picture');
  if (entry.conversion?.verdict !== 'ok') throw new Error('fixture');
  const map = entry.conversion.maps[0];
  if (map === undefined) throw new Error('fixture');
  const picture = { kind: 'picture', file: '0123456789abcdef.png', width: 3, height: 2 } as const;
  const briefing: MapBriefing = { texts: { pol: { '500': [picture, picture] } } };
  const fetchFile = vi.fn<typeof fetch>(
    async () => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } }),
  );
  vi.spyOn(guiGfx, 'hypertextPictureUrl').mockImplementation((name) => `/gui/${name}`);
  vi.spyOn(mapSources, 'findMapSource').mockResolvedValue({
    entry: map.index,
    catalog: { entryId: entry.id, fingerprint: map.fingerprint, irVersion: entry.conversion.irVersion },
    stale: false,
    fetch: fetchFile,
  });
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const pictures = await mapBriefingPictures(map.mapId, briefing);
  const url = pictures.url(picture.file);
  expect(url).toMatch(/^blob:/);
  expect(fetchFile).toHaveBeenCalledExactlyOnceWith(`/maps/${map.mapId}.pictures-${picture.file}`);
  expect(pictures.url('shared.png')).toBe('/gui/shared.png');
  pictures.dispose();
  expect(revoke).toHaveBeenCalledExactlyOnceWith(url);
});
