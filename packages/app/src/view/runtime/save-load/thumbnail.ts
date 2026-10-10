/** A save's picture: 16:9, small enough that a long list holds dozens without weight. */
export const THUMBNAIL_WIDTH = 240;
export const THUMBNAIL_HEIGHT = 135;
const THUMBNAIL_TYPE = 'image/webp';
const THUMBNAIL_QUALITY = 0.8;
/** The world is drawn at this multiple of the picture's width before the downscale smooths it. */
const OVERSAMPLE = 2;

export interface PictureSource {
  /** The screen's world, rendered at `resolution` of its device-independent size. */
  worldPicture(resolution: number): unknown;
}

/** The world under the menu as an encoded picture; null where the browser cannot draw or encode it. */
export async function worldThumbnail(source: PictureSource, screenWidth: number): Promise<Blob | null> {
  if (screenWidth <= 0) return null;
  const picture = source.worldPicture((THUMBNAIL_WIDTH * OVERSAMPLE) / screenWidth);
  if (!(picture instanceof HTMLCanvasElement)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_WIDTH;
  canvas.height = THUMBNAIL_HEIGHT;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  // Cover: fill the frame and crop the longer side about the centre, as the player saw it.
  const scale = Math.max(THUMBNAIL_WIDTH / picture.width, THUMBNAIL_HEIGHT / picture.height);
  const width = picture.width * scale;
  const height = picture.height * scale;
  context.imageSmoothingQuality = 'high';
  context.drawImage(picture, (THUMBNAIL_WIDTH - width) / 2, (THUMBNAIL_HEIGHT - height) / 2, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, THUMBNAIL_TYPE, THUMBNAIL_QUALITY));
}
