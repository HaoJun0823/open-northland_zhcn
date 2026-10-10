import type { HypertextPicture } from '@open-northland/data';
import {
  type IncludeResolver,
  type PictureResolver,
  renderHypertext,
} from '@open-northland/formats/hypertext';
import { assertPaletteBytes, paletteToRgba } from '@open-northland/formats/image';
import { decodePcx } from '@open-northland/formats/pcx';
import { encodePng } from '@open-northland/formats/png';
import { errorMessage } from './errors.js';

/** Pictures are content-addressed: the corpus repeats the same portraits across map folders and
 *  languages, so equal bytes converge on one file name. */
const NAME_DIGEST_CHARS = 16;
/** Observation over the corpus: a page picture surrounds its subject with palette index 0, whose
 *  entry is the key colour (magenta or blue), so that index draws as nothing. */
const COLOR_KEY_INDEX = 0;
const OPAQUE = 0xff;
const HEX = 16;
const HEX_BYTE_DIGITS = 2;

/** The pictures hypertext pages name: PNG bytes by emitted file name, and the resolver a render uses. */
export interface PagePictures {
  readonly picture: PictureResolver;
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/**
 * Converts every picture `pages` name and returns the resolver a second render looks them up through;
 * the first render collects the names through the same includes. `read` finds a picture by its
 * lower-cased file name. An absent or undecodable picture warns and is left out, so its page renders
 * without it.
 */
export async function collectPagePictures(
  read: (name: string) => Promise<Uint8Array | undefined> | Uint8Array | undefined,
  pages: Iterable<string>,
  include: IncludeResolver,
  warn: (message: string) => void,
): Promise<PagePictures> {
  const wanted = new Set<string>();
  const collect: PictureResolver = (name) => {
    wanted.add(name);
    return undefined;
  };
  for (const page of pages) renderHypertext(page, { include, picture: collect });
  const pictures = new Map<string, HypertextPicture>();
  const files = new Map<string, Uint8Array>();
  for (const name of wanted) {
    try {
      const bytes = await read(name);
      if (bytes === undefined) {
        warn(`picture ${name} not found`);
        continue;
      }
      const { picture, png } = await convertPicture(bytes);
      pictures.set(name, picture);
      files.set(picture.file, png);
    } catch (err) {
      warn(`picture ${name} undecodable: ${errorMessage(err)}`);
    }
  }
  return { picture: (name) => pictures.get(name), files };
}

async function convertPicture(bytes: Uint8Array): Promise<{ picture: HypertextPicture; png: Uint8Array }> {
  const { width, height, pixels, palette } = decodePcx(bytes);
  if (palette === undefined) throw new Error('picture has no palette');
  assertPaletteBytes(palette, 'hypertext picture');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
  const name = Array.from(digest, (byte) => byte.toString(HEX).padStart(HEX_BYTE_DIGITS, '0')).join('');
  const file = `${name.slice(0, NAME_DIGEST_CHARS)}.png`;
  const rgba = paletteToRgba(pixels, palette, (i) => (pixels[i] === COLOR_KEY_INDEX ? 0 : OPAQUE));
  return { picture: { kind: 'picture', file, width, height }, png: await encodePng({ width, height, rgba }) };
}
