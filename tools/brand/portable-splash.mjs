import sharp from 'sharp';

/** The portable launcher needs an opaque, uncompressed Windows bitmap before Electron starts. */
export async function portableSplash(logo) {
  const width = 640;
  const height = 400;
  const mark = await sharp(logo).resize({ height: 260 }).png().toBuffer({ resolveWithObject: true });
  const card = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400">
    <rect width="640" height="400" fill="#0c1420"/>
    <rect x="1" y="1" width="638" height="398" fill="none" stroke="#68583c"/>
    <path d="M240 301 H400" stroke="#b79a62"/>
    <g text-anchor="middle" font-family="sans-serif">
      <text x="320" y="334" font-size="20" fill="#f0e6d2">Preparing game files…</text>
      <text x="320" y="364" font-size="16" fill="#b9b7b0">Please wait</text>
    </g>
  </svg>`);
  const { data, info } = await sharp(card)
    .composite([{ input: mark.data, top: 24, left: Math.round((width - mark.info.width) / 2) }])
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // BITMAPINFOHEADER, 24-bit BGR rows stored bottom-up and padded to four bytes.
  const stride = Math.ceil((width * 3) / 4) * 4;
  const pixelOffset = 54;
  const bmp = Buffer.alloc(pixelOffset + stride * height);
  bmp.write('BM');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(pixelOffset, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * info.channels;
      const target = pixelOffset + (height - 1 - y) * stride + x * 3;
      bmp[target] = data[source + 2];
      bmp[target + 1] = data[source + 1];
      bmp[target + 2] = data[source];
    }
  }
  return bmp;
}
