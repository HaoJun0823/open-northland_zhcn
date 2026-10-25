import { BufferImageSource, type TextureSource } from 'pixi.js';
import { PALETTE_LUT_WIDTH, warnFixedOverflow } from './human-palette-lut.js';

const RGB = 3;
const RGBA = 4;
const OPAQUE = 255;
/** Rows of a LUT that serves recoloured stems alone: past the 298 paletted stems of the pack, and its
 *  own texture, so it takes no human's rows. */
const DEFAULT_PALETTE_ROWS = 512;

/** The LUT recoloured frames draw through: a row per stem palette. */
export interface RecolourLut {
  readonly source: TextureSource;
  /** The row of `palette` (256 RGB entries), written on first ask. */
  fixedRow(palette: Uint8Array): number;
}

/**
 * The recolour LUT of a sheet without human palettes, whose world batch reads no other LUT: one row per
 * stem palette. Past its rows a new palette reads the first row, with a warning.
 */
export class PaletteRowsLut implements RecolourLut {
  /** Palettes past the rows, drawn through the first row instead. */
  overflows = 0;
  private readonly rows: Uint8Array;
  private readonly lut: BufferImageSource;
  private readonly rowOf = new WeakMap<Uint8Array, number>();
  /** Rows written so far, one per stem palette. */
  private written = 0;

  constructor(private readonly capacity = DEFAULT_PALETTE_ROWS) {
    this.rows = new Uint8Array(capacity * PALETTE_LUT_WIDTH * RGBA);
    this.lut = new BufferImageSource({
      resource: this.rows,
      width: PALETTE_LUT_WIDTH,
      height: capacity,
      format: 'rgba8unorm',
      scaleMode: 'nearest',
    });
  }

  get source(): TextureSource {
    return this.lut;
  }

  fixedRow(palette: Uint8Array): number {
    const held = this.rowOf.get(palette);
    if (held !== undefined) return held;
    const isNew = this.written < this.capacity;
    const row = isNew ? this.written++ : 0;
    if (isNew) {
      let at = row * PALETTE_LUT_WIDTH * RGBA;
      for (let i = 0; i < palette.length; i += RGB, at += RGBA) {
        this.rows[at] = palette[i] ?? 0;
        this.rows[at + 1] = palette[i + 1] ?? 0;
        this.rows[at + 2] = palette[i + 2] ?? 0;
        this.rows[at + 3] = OPAQUE;
      }
      this.lut.update();
    } else if (this.overflows++ === 0) {
      warnFixedOverflow(this.capacity);
    }
    this.rowOf.set(palette, row);
    return row;
  }
}
