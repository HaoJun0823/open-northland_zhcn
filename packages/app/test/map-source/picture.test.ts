import { encodePng } from '@open-northland/formats/png';
import { expect, it } from 'vitest';
import { boundedMapPicture } from '../../src/content/map-source/picture.js';

it('refuses missing image data, truncation and oversized dimensions before decoding pixels', async () => {
  const valid = await encodePng({ width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) });
  expect(boundedMapPicture(valid)).toBe(true);
  expect(boundedMapPicture(valid.slice(0, 8))).toBe(false);
  expect(boundedMapPicture(valid.slice(0, -1))).toBe(false);
  const huge = valid.slice();
  new DataView(huge.buffer).setUint32(16, 0x7fffffff);
  expect(boundedMapPicture(huge)).toBe(false);
  const empty = valid.slice();
  new DataView(empty.buffer).setUint32(20, 0);
  expect(boundedMapPicture(empty)).toBe(false);
});
