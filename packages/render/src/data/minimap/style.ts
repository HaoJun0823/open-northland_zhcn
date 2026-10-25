import { clamp, clamp01 } from '../math.js';
import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import { buildMinimapCellField, FIELD_COVER, FIELD_STRIDE } from './cells.js';
import { LandPainter } from './land.js';
import { MINIMAP_LIGHT } from './light.js';
import { terrainWorldBounds } from './map-preview.js';
import { hash2, smoothstep, valueNoise, valueNoisePair } from './noise.js';
import { SAMPLE_LANES, sampleField } from './sampler.js';
import type { MinimapScene } from './scene.js';
import { COAST, SeaPainter } from './sea.js';
import { contrastCurve, lightFrame, luma, mixToward, type Rgb, saturate, textureFade } from './texture.js';

/**
 * The styled minimap raster every consumer shares: lobby preview, pipeline card and in-game surface.
 * An Open Northland enhancement over the original's flat per-cell minimap, aiming at a relief-map look;
 * every look value below is a named approximation tuned by eye, not a measured or extracted one.
 */

/** Samples per cell pitch the raster aims for; smaller pictures supersample up to the cap per axis. */
const SAMPLES_PER_CELL = 1.5;
const MAX_SAMPLES = 4;
/** The coast's anti-aliased edge width in samples. */
const COAST_EDGE_SAMPLES = 1.2;
/** The surf line on the water side and the bank shade on the land side, in px, capped in water units. */
const FOAM_PX = 1;
const FOAM_MAX_BAND = 0.4;
const FOAM = 0xe4eee8;
const FOAM_ALPHA = 0.4;
const BANK_PX = 1.5;
const BANK_MAX_BAND = 0.45;
const BANK_SHADE = 0.22;
const SURF_FLOOR = 0.6;
const SURF_PERIOD_CELLS = 0.6;
/** A dark wet line on the land side of the coast, so islands and lakes read crisply on a small picture:
 *  its width in px, capped in water units, and its shade, full up to {@link WET_FULL_PITCH_PX} px per
 *  cell and easing to {@link WET_FLOOR} of that by {@link WET_FADED_PITCH_PX}, where the texture
 *  already draws the shore. */
const WET_PX = 1;
const WET_MAX_BAND = 0.35;
const WET_SHADE = 0.45;
const WET_FULL_PITCH_PX = 3;
const WET_FADED_PITCH_PX = 8;
const WET_FLOOR = 0.4;
/** The cell pitch in px up to which per-pixel grain keeps full strength; above it it scales by
 *  `GRAIN_FULL_PX / pitch`, down to the floor, since grain at one px per cell is noise at three. */
const GRAIN_FULL_PX = 1.2;
const GRAIN_MIN_SCALE = 0.2;
const GRAIN = 0.05;

/** Domain warp of the sample position, so ground-pattern borders and the coast do not follow the cell
 *  diamonds: its period and its largest offset, in cells. */
const WARP_PERIOD_CELLS = 1.6;
const WARP_CELLS = 0.3;

/** Seeds keeping the noise layers independent. */
const SEED_GRAIN = 0x9e3779b9;
const SEED_SURF = 0x7ed55d16;
const SEED_WARP = 0x1b873593;

const BYTE_MAX = 255;

/** Everything a raster of one scene at one size computes once, shared by every pixel it paints. */
interface RasterSetup {
  readonly minX: number;
  readonly minY: number;
  readonly worldPerPxX: number;
  readonly worldPerPxY: number;
  readonly cellPx: number;
  readonly grainAmount: number;
  readonly samples: number;
  readonly coastEdge: number;
  readonly foamBand: number;
  readonly bankBand: number;
  readonly wetBand: number;
  readonly wetShade: number;
  readonly textured: boolean;
  readonly warpReach: number;
}

function rasterSetup(scene: Pick<MinimapScene, 'width' | 'height'>, pxW: number, pxH: number): RasterSetup {
  const bounds = terrainWorldBounds(scene.width, scene.height);
  const worldPerPxX = bounds.width / pxW;
  const worldPerPxY = bounds.height / pxH;
  const cellPx = Math.min((2 * TILE_HALF_W) / worldPerPxX, (2 * TILE_HALF_H) / worldPerPxY);
  const samples = clamp(Math.ceil(SAMPLES_PER_CELL / cellPx), 1, MAX_SAMPLES);
  const wetFade = clamp01((cellPx - WET_FULL_PITCH_PX) / (WET_FADED_PITCH_PX - WET_FULL_PITCH_PX));
  // Sub-cell texture fades in with the pitch and stays off while the picture supersamples, so it never
  // needs supersampling itself.
  const textured = samples === 1;
  const cellW = 2 * TILE_HALF_W;
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    worldPerPxX,
    worldPerPxY,
    cellPx,
    grainAmount: GRAIN * clamp(GRAIN_FULL_PX / cellPx, GRAIN_MIN_SCALE, 1),
    samples,
    coastEdge: Math.min(1, COAST_EDGE_SAMPLES / (cellPx * samples)),
    foamBand: Math.min(FOAM_MAX_BAND, FOAM_PX / cellPx),
    bankBand: Math.min(BANK_MAX_BAND, BANK_PX / cellPx),
    wetBand: Math.min(WET_MAX_BAND, WET_PX / cellPx),
    wetShade: WET_SHADE * (1 - (1 - WET_FLOOR) * wetFade),
    textured,
    warpReach: textured ? 2 * WARP_CELLS * cellW * textureFade(WARP_PERIOD_CELLS, cellPx) : 0,
  };
}

/**
 * Rasterize the styled minimap: `pxW × pxH` RGBA, row-major, spanning `terrainWorldBounds`; opaque
 * except for an empty grid or picture, which stays all zero. Pure and deterministic; cost is one pass
 * over the cells plus one over the samples.
 */
export function rasterizeMinimap(scene: MinimapScene, pxW: number, pxH: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, pxW * pxH * 4));
  if (scene.width <= 0 || scene.height <= 0 || pxW <= 0 || pxH <= 0) return out;
  rasterizeMinimapRegion(scene, buildMinimapCellField(scene), pxW, pxH, out, 0, 0, pxW, pxH);
  return out;
}

/**
 * Paint the columns `[x0, x1)` of the rows `[y0, y1)` of {@link rasterizeMinimap}'s picture into `out`
 * (`pxW × pxH` RGBA) from `field`, the scene's {@link buildMinimapCellField}: every pixel depends only on
 * its own place and the field, so a region painted alone matches the whole picture there.
 */
export function rasterizeMinimapRegion(
  scene: Pick<MinimapScene, 'width' | 'height'>,
  field: Float32Array,
  pxW: number,
  pxH: number,
  out: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  if (scene.width <= 0 || scene.height <= 0 || pxW <= 0 || pxH <= 0) return;
  // Writes through the clamped view round and clamp each channel to a byte.
  const bytes = new Uint8ClampedArray(out.buffer, out.byteOffset, out.length);
  const setup = rasterSetup(scene, pxW, pxH);
  const { minX, minY, worldPerPxX, worldPerPxY, cellPx, grainAmount, samples, coastEdge } = setup;
  const { foamBand, bankBand, wetBand, wetShade, textured, warpReach } = setup;
  const light = lightFrame(MINIMAP_LIGHT);
  const land = new LandPainter(cellPx, textured, light);
  const sea = new SeaPainter(cellPx, textured, light);
  const sample: Rgb = { r: 0, g: 0, b: 0 };
  const seaRgb: Rgb = { r: 0, g: 0, b: 0 };
  const s = new Float64Array(SAMPLE_LANES);
  const warp = new Float64Array(2);
  const curve = contrastCurve();
  const inv = 1 / (samples * samples);
  const cellW = 2 * TILE_HALF_W;
  const warpScale = 1 / (WARP_PERIOD_CELLS * cellW);
  const surfScale = 1 / (SURF_PERIOD_CELLS * cellW);
  for (let py = Math.max(0, y0); py < Math.min(pxH, y1); py++) {
    const rowY = minY + (py + 0.5) * worldPerPxY;
    for (let px = Math.max(0, x0); px < Math.min(pxW, x1); px++) {
      let x = minX + (px + 0.5) * worldPerPxX;
      let y = rowY;
      if (warpReach > 0) {
        valueNoisePair(x * warpScale, y * warpScale, SEED_WARP, warp);
        x += ((warp[0] ?? 0.5) - 0.5) * warpReach;
        y += ((warp[1] ?? 0.5) - 0.5) * warpReach;
      }
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy++) {
        const wy = y + ((sy + 0.5) / samples - 0.5) * worldPerPxY;
        for (let sx = 0; sx < samples; sx++) {
          const wx = x + ((sx + 0.5) / samples - 0.5) * worldPerPxX;
          sampleField(field, scene.width, scene.height, wx, wy, s);
          const water = s[FIELD_COVER] ?? 0;
          const edgeT = (water - COAST) / coastEdge + 0.5;
          const cover = edgeT <= 0 ? 0 : edgeT >= 1 ? 1 : smoothstep(edgeT);
          sample.r = 0;
          sample.g = 0;
          sample.b = 0;
          if (cover < 1) {
            land.paint(s, wx, wy, px, py, sample);
            const bank = 1 - (COAST - water) / bankBand;
            const wet = 1 - (COAST - water) / wetBand;
            let share = bank > 0 ? (1 - cover) * (1 - BANK_SHADE * Math.min(1, bank)) : 1 - cover;
            if (wet > 0) share *= 1 - wetShade * Math.min(1, wet);
            sample.r *= share;
            sample.g *= share;
            sample.b *= share;
          }
          if (cover > 0) {
            sea.paint(s, wx, wy, seaRgb);
            sample.r += seaRgb.r * cover;
            sample.g += seaRgb.g * cover;
            sample.b += seaRgb.b * cover;
            const edge = 1 - (water - COAST) / foamBand;
            if (edge > 0) {
              // Foam paints over the whole sample, land share included.
              const surf = valueNoise(wx * surfScale, wy * surfScale, SEED_SURF);
              mixToward(
                sample,
                FOAM,
                cover * Math.min(1, edge) * FOAM_ALPHA * (SURF_FLOOR + (1 - SURF_FLOOR) * surf),
              );
            }
          }
          r += sample.r;
          g += sample.g;
          b += sample.b;
        }
      }
      const grain = inv * (1 + grainAmount * (hash2(px, py, SEED_GRAIN) - 0.5));
      r *= grain;
      g *= grain;
      b *= grain;
      const tone = luma(r, g, b);
      const o = (py * pxW + px) * 4;
      bytes[o] = curve[toByte(saturate(r, tone))] ?? 0;
      bytes[o + 1] = curve[toByte(saturate(g, tone))] ?? 0;
      bytes[o + 2] = curve[toByte(saturate(b, tone))] ?? 0;
      bytes[o + 3] = BYTE_MAX;
    }
  }
}

/** Picture px per side of the tiles {@link changedMinimapTiles} marks. */
export const MINIMAP_TILE_PX = 32;
/** How far from a cell centre a sample still reads that cell's field, in half cells across and rows
 *  down, with one more of each as margin: the sampler's triangles reach two half cells and one row. */
const SAMPLE_REACH_HALF_CELLS = 3;
const SAMPLE_REACH_ROWS = 2;

/**
 * The {@link MINIMAP_TILE_PX} tiles of a `pxW × pxH` picture whose pixels can differ between the
 * pictures of the cell fields `before` and `after`, one flag per tile, row-major, `Math.ceil(pxW /
 * MINIMAP_TILE_PX)` across: every tile a changed cell's field reaches through the sampler's triangle,
 * the domain warp and the supersamples. Null when no cell's field changed.
 */
export function changedMinimapTiles(
  scene: Pick<MinimapScene, 'width' | 'height'>,
  before: Float32Array,
  after: Float32Array,
  pxW: number,
  pxH: number,
): Uint8Array | null {
  const { width, height } = scene;
  if (before.length !== after.length || width <= 0 || height <= 0 || pxW <= 0 || pxH <= 0) return null;
  const { minX, minY, worldPerPxX, worldPerPxY, warpReach } = rasterSetup(scene, pxW, pxH);
  const tilesW = Math.ceil(pxW / MINIMAP_TILE_PX);
  const tilesH = Math.ceil(pxH / MINIMAP_TILE_PX);
  const tiles = new Uint8Array(tilesW * tilesH);
  const reachX = SAMPLE_REACH_HALF_CELLS * TILE_HALF_W + warpReach / 2;
  const reachY = SAMPLE_REACH_ROWS * TILE_HALF_H + warpReach / 2;
  let changed = false;
  for (let cell = 0; cell < width * height; cell++) {
    const o = cell * FIELD_STRIDE;
    let same = true;
    for (let lane = 0; lane < FIELD_STRIDE && same; lane++) same = before[o + lane] === after[o + lane];
    if (same) continue;
    changed = true;
    const row = Math.floor(cell / width);
    const cx = (2 * (cell - row * width) + (row & 1)) * TILE_HALF_W;
    const cy = row * TILE_HALF_H;
    // A pixel's samples span its own width either side of its centre's warped place.
    const px0 = clamp(Math.floor((cx - reachX - minX) / worldPerPxX) - 1, 0, pxW - 1);
    const px1 = clamp(Math.ceil((cx + reachX - minX) / worldPerPxX), 0, pxW - 1);
    const py0 = clamp(Math.floor((cy - reachY - minY) / worldPerPxY) - 1, 0, pxH - 1);
    const py1 = clamp(Math.ceil((cy + reachY - minY) / worldPerPxY), 0, pxH - 1);
    for (let ty = Math.floor(py0 / MINIMAP_TILE_PX); ty <= Math.floor(py1 / MINIMAP_TILE_PX); ty++)
      for (let tx = Math.floor(px0 / MINIMAP_TILE_PX); tx <= Math.floor(px1 / MINIMAP_TILE_PX); tx++)
        tiles[ty * tilesW + tx] = 1;
  }
  return changed ? tiles : null;
}

function toByte(v: number): number {
  return v <= 0 ? 0 : v >= BYTE_MAX ? BYTE_MAX : (v + 0.5) | 0;
}
