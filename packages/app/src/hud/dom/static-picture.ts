import { setAttribute } from './parts/dom.js';

/**
 * Pictures the HUD shows still (a building's thumbnail, a notice's glyph art, a nation's emblem), drawn
 * once on one shared scratch canvas and kept as a data URL for an `<img>`. A canvas on the page per
 * picture is a composited layer and a GPU surface of its own, and a CSS filter over one makes the
 * compositor run a pass for it every frame; an image paints into the panel's own layer once.
 */

/** A drawn picture and its pixel size. */
export interface StaticPicture {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

export interface StaticPictures {
  /**
   * The picture under `key`, drawn by `draw` into a cleared `width` x `height` context the first time it
   * is asked for; null when the page gives no 2d context.
   */
  picture(
    key: string,
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ): StaticPicture | null;
}

/** The one scratch canvas every picture is drawn on: off the page, and read back for each picture. */
let scratch: CanvasRenderingContext2D | null = null;

function scratchContext(): CanvasRenderingContext2D | null {
  scratch ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  return scratch;
}

/** A cache of pictures by key; each owner keys by what its pictures depend on. */
export function createStaticPictures(): StaticPictures {
  const pictures = new Map<string, StaticPicture>();
  return {
    picture: (key, width, height, draw) => {
      const known = pictures.get(key);
      if (known !== undefined) return known;
      const ctx = scratchContext();
      if (ctx === null) return null;
      // Setting the size clears the canvas and resets its state, so each picture starts blank.
      ctx.canvas.width = width;
      ctx.canvas.height = height;
      draw(ctx);
      const drawn = { url: ctx.canvas.toDataURL(), width, height };
      pictures.set(key, drawn);
      return drawn;
    },
  };
}

/** The markup of an empty picture slot, decorative and not draggable, which a painter fills. */
export const PICTURE_SLOT = '<img alt="" draggable="false">';

/** An empty picture slot, as {@link PICTURE_SLOT} makes one. */
export function pictureSlot(): HTMLImageElement {
  const image = document.createElement('img');
  image.alt = '';
  image.draggable = false;
  return image;
}

/** Show `picture` in `image`, sized by its pixels as a canvas of that backing size would lay out. The
 *  attributes are compared, not the `width` property, which reads the layout. */
export function showPicture(image: HTMLImageElement, picture: StaticPicture): void {
  setAttribute(image, 'width', String(picture.width));
  setAttribute(image, 'height', String(picture.height));
  setAttribute(image, 'src', picture.url);
}
