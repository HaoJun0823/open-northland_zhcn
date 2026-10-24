import { BufferImageSource, Rectangle, Texture } from 'pixi.js';
import { BLOOD_PALETTES, type BloodPalette } from '../../data/effects/blood-appearance.js';
import { frac } from '../../data/effects/random.js';

const CELL = 48;
const VARIANTS = 16;
const COLUMNS = 8;

/** Authored shared atlas: dark pooled centres, red thin edges, wet glints and satellite droplets.
 * Generated from our own shapes; no game assets or per-mark canvas/GPU surfaces. */
export class BloodTextures {
  private readonly source: BufferImageSource;
  readonly stains: readonly Texture[];
  readonly drop: Texture;
  private readonly drops: readonly Texture[];

  constructor() {
    const width = CELL * COLUMNS;
    const paletteHeight = CELL * 3;
    const height = paletteHeight * BLOOD_PALETTES.length;
    const pixels = new Uint8Array(width * height * 4);
    for (let variant = 0; variant < VARIANTS; variant++) {
      const seed = variant * 7919 + 17;
      const lobes = Array.from({ length: 11 }, (_, i) => ({
        x: (frac(seed, i * 4) - 0.5) * 25,
        y: (frac(seed, i * 4 + 1) - 0.5) * 23,
        rx: 2 + frac(seed, i * 4 + 2) * 9,
        ry: 2 + frac(seed, i * 4 + 3) * 8,
      }));
      for (let y = 0; y < CELL; y++) {
        for (let x = 0; x < CELL; x++) {
          let field = -1;
          for (const lobe of lobes) {
            const dx = (x - CELL / 2 - lobe.x) / lobe.rx;
            const dy = (y - CELL / 2 - lobe.y) / lobe.ry;
            field = Math.max(field, 1 - dx * dx - dy * dy);
          }
          const grain = frac(seed, 100 + y * CELL + x);
          const coverage = Math.min(1, Math.max(0, field * 4 + (grain - 0.5) * 0.35));
          const depth = Math.min(1, Math.max(0, field));
          const marbling = Math.sin(x * 0.53 + seed) * Math.sin(y * 0.41 + variant) * 0.1;
          const thin = Math.max(0, Math.min(1, 1 - depth + marbling));
          const glint = Math.max(0, 1 - Math.hypot(x - 20, y - 17) / 2.5) * depth;
          const shade = 0.8 + frac(seed, 94) * 0.6;
          const red = Math.round((105 + thin * 18 + marbling * 85 + glint * 70 + grain * 4) * shade);
          const green = Math.round(8 + thin * 3 + glint * 40 + grain * 2);
          const blue = Math.round(11 + thin * 3 + glint * 30);
          const offset = (((variant >> 3) * CELL + y) * width + (variant % COLUMNS) * CELL + x) * 4;
          pixels.set([red, green, blue, Math.round(coverage * (0.94 + grain * 0.06) * 255)], offset);
        }
      }
    }
    // A small asymmetric droplet; its long axis is x, aligned to instantaneous velocity by the layer.
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const dx = (x - 3.5) / 3.2;
        const dy = (y - 3.5) / (1.5 + x * 0.1);
        const edge = Math.max(0, Math.min(1, (1 - dx * dx - dy * dy) * 2));
        const light = Math.round(140 + 85 * edge);
        pixels.set(
          [light, Math.round(12 + 27 * edge), 19, Math.round(edge * 255)],
          ((CELL * 2 + y) * width + x) * 4,
        );
      }
    }
    const paletteBytes = width * paletteHeight * 4;
    for (let palette = 1; palette < BLOOD_PALETTES.length; palette++) {
      const transform = BLOOD_PALETTES[palette];
      if (transform === undefined) continue;
      for (let at = 0; at < paletteBytes; at += 4) {
        for (let channel = 0; channel < 3; channel++) {
          const sourceChannel = transform.swap ? 2 - channel : channel;
          pixels[palette * paletteBytes + at + channel] = Math.min(
            255,
            Math.round(
              (pixels[at + sourceChannel] ?? 0) * (transform.rgb[channel] ?? 1) +
                (pixels[at] ?? 0) * transform.neutral,
            ),
          );
        }
        pixels[palette * paletteBytes + at + 3] = pixels[at + 3] ?? 0;
      }
    }
    this.source = new BufferImageSource({
      resource: pixels,
      width,
      height,
      scaleMode: 'linear',
      autoGenerateMipmaps: false,
    });
    this.stains = Array.from(
      { length: VARIANTS * BLOOD_PALETTES.length },
      (_, i) =>
        new Texture({
          source: this.source,
          frame: new Rectangle(
            (i % COLUMNS) * CELL,
            ((i % VARIANTS) >> 3) * CELL + Math.floor(i / VARIANTS) * paletteHeight,
            CELL,
            CELL,
          ),
        }),
    );
    this.drops = BLOOD_PALETTES.map(
      (_, palette) =>
        new Texture({
          source: this.source,
          frame: new Rectangle(0, CELL * 2 + palette * paletteHeight, 8, 8),
        }),
    );
    this.drop = this.droplet(0);
  }

  stain(seed: number, palette: BloodPalette = 0): Texture {
    return this.stains[palette * VARIANTS + (seed % VARIANTS)] ?? this.drop;
  }

  droplet(palette: BloodPalette): Texture {
    const texture = this.drops[palette];
    if (texture === undefined) throw new Error('Missing blood pigment');
    return texture;
  }

  destroy(): void {
    for (const texture of this.stains) texture.destroy();
    for (const texture of this.drops) texture.destroy();
    this.source.destroy();
  }
}
