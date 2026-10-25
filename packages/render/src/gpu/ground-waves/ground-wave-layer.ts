import {
  Container,
  Rectangle,
  type Renderer,
  RenderTexture,
  Sprite,
  Texture,
  type TextureSource,
} from 'pixi.js';
import { isVisible, TILE_HALF_W, type Viewport } from '../../data/projection/index.js';
import type { Camera } from '../../data/projection/iso.js';
import type { AtlasFrame } from '../../data/sprites/atlas.js';
import { TERRAIN_CHUNK_TILES } from '../terrain/index.js';
import { type GroundWave, groundWaveFrameAt } from './ground-wave.js';
import { GroundWaveLift, type ScreenRect } from './ground-wave-filter.js';

/** Waves are indexed in square blocks of the terrain chunk's horizontal pitch by their anchors, the
 *  point the cull tests, so a frame looks up only the blocks under the view. */
const BLOCK_PX = TERRAIN_CHUNK_TILES * TILE_HALF_W * 2;
/** Blocks on one row are this many keys apart, more than any map has columns. */
const BLOCK_ROW_STRIDE = 1 << 16;

const blockOf = (px: number): number => Math.floor(px / BLOCK_PX);
const blockKeyAt = (column: number, row: number): number => row * BLOCK_ROW_STRIDE + column;
const blockKey = (wave: GroundWave): number => blockKeyAt(blockOf(wave.x), blockOf(wave.y));

interface WaveBlock {
  /** Blocks draw in the order their first wave was placed, so overlapping waves keep their order. */
  readonly order: number;
  readonly waves: GroundWave[];
}

const byPlacement = (a: WaveBlock, b: WaveBlock): number => a.order - b.order;

/** What the last lift map was drawn from; the same inputs draw the same map. */
interface LiftInputs {
  tick: number;
  offsetX: number;
  offsetY: number;
  zoom: number;
  screenW: number;
  screenH: number;
  resolution: number;
  /** Bumped by every {@link GroundWaveLayer.set} and {@link GroundWaveLayer.remove}. */
  revision: number;
}

/**
 * The shore waves. Original behavior: after the ground and the static landscape objects are drawn and
 * before creatures, each wave's current bob copies, for every written texel of value `v`, the pixel `v`
 * rows below it into its place, so the ground under the wave rises by 1 to 6 px while settlers stay put. Here the visible
 * waves render into a screen-sized lift map, redrawn when the tick, the camera, the screen or the waves
 * change, and a pass drawn after the ground chunks applies it under the wave quads. Approximations:
 * overlapping waves take the last drawn value instead of chaining their copies,
 * and static landscape objects, which the original lifts with the ground, stay put.
 */
export class GroundWaveLayer {
  /** The render root of the lift map; {@link view} carries the camera under it. */
  private readonly root = new Container();
  private readonly view = new Container();
  private readonly sprites: Sprite[] = [];
  private readonly blocks = new Map<number, WaveBlock>();
  /** This frame's blocks in view, in placement order. */
  private readonly inView: WaveBlock[] = [];
  private revision = 0;
  /** Null until a map is drawn, and after a frame without one. */
  private drawnFrom: LiftInputs | null = null;
  private readonly textures = new Map<AtlasFrame, Texture>();
  private map: RenderTexture | null = null;
  private readonly lift = new GroundWaveLift(Texture.EMPTY.source);
  /** The drawn waves' rectangles, `[x0, y0, x1, y1]` world px each, grown on demand. */
  private rects = new Float32Array(0);
  private readonly screenRect: ScreenRect = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  /** A restored GL context brings the lift map back blank, so the next frame draws it again. */
  private readonly onContextChange = {
    contextChange: (): void => {
      this.drawnFrom = null;
    },
  };

  constructor(
    private readonly renderer: Renderer,
    private readonly ground: Container,
  ) {
    this.root.addChild(this.view);
    ground.addChild(this.lift.node);
    renderer.runners.contextChange.add(this.onContextChange);
  }

  /** Call once per map. */
  set(waves: readonly GroundWave[]): void {
    this.blocks.clear();
    this.dropTextures();
    this.revision++;
    for (const wave of waves) {
      if (wave.frames.length === 0) continue;
      // The frames hold values, not colours: a filtered sample would invent lifts between them.
      wave.source.scaleMode = 'nearest';
      const key = blockKey(wave);
      let block = this.blocks.get(key);
      if (block === undefined) {
        block = { order: this.blocks.size, waves: [] };
        this.blocks.set(key, block);
      }
      block.waves.push(wave);
    }
  }

  /** Take one placed wave out (a script removed it); O(its block). An unknown wave is a no-op. */
  remove(wave: GroundWave): void {
    const waves = this.blocks.get(blockKey(wave))?.waves;
    const index = waves?.indexOf(wave) ?? -1;
    if (index >= 0) waves?.splice(index, 1);
    this.revision++;
  }

  /**
   * Render this frame's lift map and switch the lift on, or off when no wave is on screen or `enabled`
   * is false. With any wave on screen the frame copies the ground under the waves and draws their
   * quads, plus a lift-map render whenever the tick, the camera, the screen or the waves changed.
   */
  update(
    vp: Viewport,
    camera: Camera,
    screenW: number,
    screenH: number,
    tick: number,
    enabled: boolean,
  ): void {
    const zoom = camera.scale ?? 1;
    const resolution = this.renderer.resolution;
    if (enabled && this.unchanged(tick, camera, zoom, screenW, screenH, resolution)) return;
    let drawn = 0;
    // One target pixel round each quad covers whatever the lift map's own rasterisation of it touches.
    const pad = 1 / (zoom * resolution);
    if (enabled) {
      for (const block of this.blocksInView(vp)) {
        for (const wave of block.waves) {
          if (!isVisible(vp, wave.x, wave.y)) continue;
          const frame = groundWaveFrameAt(wave, tick);
          if (frame === undefined || frame.width <= 0 || frame.height <= 0) continue;
          const sprite = this.sprites[drawn] ?? this.mintSprite();
          const x = wave.x + frame.offsetX;
          const y = wave.y - (wave.lift ?? 0) + frame.offsetY;
          sprite.texture = this.textureFor(wave.source, frame);
          sprite.position.set(x, y);
          sprite.visible = true;
          this.rectAt(drawn, x - pad, y - pad, x + frame.width + pad, y + frame.height + pad);
          drawn++;
        }
      }
    }
    for (let i = drawn; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      if (sprite !== undefined) sprite.visible = false;
    }
    if (drawn === 0) {
      this.drawnFrom = null;
      this.setApplied(false);
      return;
    }
    this.view.scale.set(zoom);
    this.view.position.set(camera.offsetX, camera.offsetY);
    const retired = this.map;
    const map = this.mapSized(screenW, screenH);
    this.renderer.render({ container: this.root, target: map, clear: true });
    this.lift.set(map.source, screenW, screenH, zoom, this.rects, drawn, this.screenOf(drawn, camera, zoom));
    // Only once the lift samples the new map: a bound texture destroyed under a shader is a Pixi warning.
    if (retired !== null && retired !== map) retired.destroy(true);
    this.setApplied(true);
    this.drawnFrom = {
      tick,
      offsetX: camera.offsetX,
      offsetY: camera.offsetY,
      zoom,
      screenW,
      screenH,
      resolution,
      revision: this.revision,
    };
  }

  /** True when the lift map on the ground was drawn from these same inputs. */
  private unchanged(
    tick: number,
    camera: Camera,
    zoom: number,
    screenW: number,
    screenH: number,
    resolution: number,
  ): boolean {
    const last = this.drawnFrom;
    return (
      last !== null &&
      last.tick === tick &&
      last.offsetX === camera.offsetX &&
      last.offsetY === camera.offsetY &&
      last.zoom === zoom &&
      last.screenW === screenW &&
      last.screenH === screenH &&
      last.resolution === resolution &&
      last.revision === this.revision
    );
  }

  /** The blocks whose square holds the view, in placement order. */
  private blocksInView(vp: Viewport): readonly WaveBlock[] {
    const inView = this.inView;
    inView.length = 0;
    if (this.blocks.size === 0) return inView;
    for (let row = blockOf(vp.minY); row <= blockOf(vp.maxY); row++) {
      for (let column = blockOf(vp.minX); column <= blockOf(vp.maxX); column++) {
        const block = this.blocks.get(blockKeyAt(column, row));
        if (block !== undefined) inView.push(block);
      }
    }
    return inView.sort(byPlacement);
  }

  /** The lift map is framed on the main camera, so another view of the world draws the ground unlifted. */
  suspend(suspended: boolean): void {
    this.lift.suspended = suspended;
  }

  destroy(): void {
    this.renderer.runners.contextChange.remove(this.onContextChange);
    this.drawnFrom = null;
    this.setApplied(false);
    this.blocks.clear();
    this.dropTextures();
    this.root.destroy({ children: true });
    this.sprites.length = 0;
    this.lift.destroy();
    this.map?.destroy(true);
    this.map = null;
  }

  private setApplied(applied: boolean): void {
    this.lift.active = applied;
    // A rebuilt map adds its ground chunks after the lift, which has to draw over them.
    const children = this.ground.children;
    if (applied && children[children.length - 1] !== this.lift.node) this.ground.addChild(this.lift.node);
  }

  private rectAt(index: number, x0: number, y0: number, x1: number, y1: number): void {
    if (this.rects.length < (index + 1) * 4) {
      const grown = new Float32Array(Math.max(this.rects.length * 2, (index + 1) * 4));
      grown.set(this.rects);
      this.rects = grown;
    }
    this.rects.set([x0, y0, x1, y1], index * 4);
  }

  /** The screen rectangle (CSS px) of the first `count` wave rectangles under `camera`. */
  private screenOf(count: number, camera: Camera, zoom: number): ScreenRect {
    const rect = this.screenRect;
    rect.minX = Number.POSITIVE_INFINITY;
    rect.minY = Number.POSITIVE_INFINITY;
    rect.maxX = Number.NEGATIVE_INFINITY;
    rect.maxY = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < count; i++) {
      rect.minX = Math.min(rect.minX, (this.rects[i * 4] ?? 0) * zoom + camera.offsetX);
      rect.minY = Math.min(rect.minY, (this.rects[i * 4 + 1] ?? 0) * zoom + camera.offsetY);
      rect.maxX = Math.max(rect.maxX, (this.rects[i * 4 + 2] ?? 0) * zoom + camera.offsetX);
      rect.maxY = Math.max(rect.maxY, (this.rects[i * 4 + 3] ?? 0) * zoom + camera.offsetY);
    }
    return rect;
  }

  private mapSized(screenW: number, screenH: number): RenderTexture {
    const width = Math.max(1, Math.ceil(screenW));
    const height = Math.max(1, Math.ceil(screenH));
    const resolution = this.renderer.resolution;
    const map = this.map;
    if (
      map !== null &&
      map.width === width &&
      map.height === height &&
      map.source.resolution === resolution
    ) {
      return map;
    }
    const next = RenderTexture.create({ width, height, resolution, antialias: false });
    next.source.scaleMode = 'nearest';
    this.map = next;
    return next;
  }

  private mintSprite(): Sprite {
    const sprite = new Sprite();
    this.view.addChild(sprite);
    this.sprites.push(sprite);
    return sprite;
  }

  private textureFor(source: TextureSource, frame: AtlasFrame): Texture {
    let texture = this.textures.get(frame);
    if (texture === undefined) {
      texture = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
      this.textures.set(frame, texture);
    }
    return texture;
  }

  private dropTextures(): void {
    for (const texture of this.textures.values()) texture.destroy(false);
    this.textures.clear();
  }
}
