/** A save's picture: 16:9, small enough that a long list holds dozens without weight. */
export const THUMBNAIL_WIDTH = 240;
export const THUMBNAIL_HEIGHT = 135;
const PICTURE_TYPE = 'image/webp';
const THUMBNAIL_QUALITY = 0.8;
/** The world is drawn at this multiple of the picture's width before the downscale smooths it. */
const OVERSAMPLE = 2;

export interface PictureSource {
  /** The screen's world, rendered at `resolution` of its device-independent size. */
  worldPicture(resolution: number): unknown;
}

/** `picture` drawn into `frame`, covering it about the centre as the player saw it. */
function drawnPicture(
  picture: HTMLCanvasElement,
  frame: { readonly width: number; readonly height: number },
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext('2d');
  if (context === null) return Promise.resolve(null);
  const scale = Math.max(frame.width / picture.width, frame.height / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, (frame.width - width) / 2, (frame.height - height) / 2, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, PICTURE_TYPE, quality));
}

/** The world under the menu as an encoded picture; null where the browser cannot draw or encode it. */
export async function worldThumbnail(source: PictureSource, screenWidth: number): Promise<Blob | null> {
  if (screenWidth <= 0) return null;
  const picture = source.worldPicture((THUMBNAIL_WIDTH * OVERSAMPLE) / screenWidth);
  if (!(picture instanceof HTMLCanvasElement)) return null;
  return drawnPicture(picture, { width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT }, THUMBNAIL_QUALITY);
}

/** The whole screen's world, at most `maxWidth` wide, for a bug report. */
export async function worldScreenshot(
  source: PictureSource,
  screenWidth: number,
  maxWidth: number,
  quality: number,
): Promise<Blob | null> {
  if (screenWidth <= 0) return null;
  const picture = source.worldPicture(Math.min(1, (maxWidth * OVERSAMPLE) / screenWidth));
  if (!(picture instanceof HTMLCanvasElement)) return null;
  const scale = Math.min(1, maxWidth / picture.width);
  const frame = { width: Math.round(picture.width * scale), height: Math.round(picture.height * scale) };
  return drawnPicture(picture, frame, quality);
}
