import { type Container, Matrix, Point, Sprite } from 'pixi.js';
import {
  BLOOD_LIFETIME_TICKS,
  type BloodDrop,
  type BloodDropPose,
  bloodDroplet,
  smoothUnit,
} from '../../data/effects/blood.js';
import type { BloodPalette } from '../../data/effects/blood-appearance.js';
import {
  type BloodSurface,
  type BloodSurfaceSprite,
  bloodSurface,
  isBloodless,
  surfaceOf,
} from '../blood-surface.js';
import { alphaMaskOf, maskSolidAt } from '../sprite-pool/alpha-mask.js';

/** Authored presentation budgets, in world pixels and simulation ticks; no 3D collision is implied. */
export const MAX_BLOOD_SURFACES = 512;
const MAX_SPOTS = 3;
const MAX_RADIUS = 15;
const TRACE_STEP = 0.25;
const MAX_ROW_DISTANCE = 42;
// Authored drops travel vertically at most 2.05 px/tick for less than 11 ticks.
const MAX_FACADE_DRIFT = 24;
// A conservative body-height band, not a reconstruction of scenery geometry from its painted roof.
const MAX_CONTACT_HEIGHT = 32;
const GROUND_CONTACT_HEIGHT = 6;
const BUCKET_PX = 64;
/** Bucket rows stay far inside half this stride on any map, so a column and row pack into one exact key. */
const BUCKET_KEY_STRIDE = 2 ** 21;
const bucketKey = (x: number, y: number): number => x * BUCKET_KEY_STRIDE + y;
/** The bucket holding world point `(x, y)`. */
const cellKey = (x: number, y: number): number =>
  bucketKey(Math.floor(x / BUCKET_PX), Math.floor(y / BUCKET_PX));
/** A drop's age at sweep step `step` of a trace, the landing point included. */
const traceAge = (drop: BloodDrop, step: number): number =>
  drop.delay + Math.min(step * TRACE_STEP, drop.flight);

/** What one prepare's traces can reach: the cells their sweeps read and the ground rows they launch
 *  from. A trace reads nothing else, so a prepare bucketing only these finds the same contacts. */
export interface ContactReach {
  readonly cells: ReadonlySet<number>;
  readonly rows: readonly number[];
}

interface Candidate {
  readonly surface: BloodSurface;
  readonly inverse: Matrix;
  readonly scale: number;
  readonly frontY: number;
  readonly contactTop: number;
}
/** A contact proxy and the transform, bounds and surface fields it was derived from. */
interface CachedCandidate {
  readonly candidate: Candidate;
  readonly keys: readonly number[];
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly tx: number;
  readonly ty: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly groundY: number;
  readonly lift: number;
  readonly flat: boolean;
  readonly facade: boolean;
  readonly clipY: number;
}
export interface SurfaceContact {
  readonly surface: BloodSurface;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly angle: number;
  readonly age: number;
}
interface Spot {
  readonly palette: BloodPalette;
  x: number;
  y: number;
  radius: number;
  readonly angle: number;
  readonly bornTick: number;
  tick: number;
}
interface Stain {
  surface: BloodSurface;
  readonly spots: Spot[];
  tick: number;
}

/** Contact discovery runs only for a fresh visible burst; ageing visits the capped stained set. */
export class BloodSurfaces {
  private readonly buckets = new Map<number, Candidate[]>();
  /** What the running prepare buckets; undefined buckets every candidate in every cell it covers. */
  private reach: ContactReach | undefined;
  private readonly sweepPose: BloodDropPose = {
    x: 0,
    y: 0,
    groundY: 0,
    angle: 0,
    stretch: 1,
    landed: false,
    visible: false,
  };
  private readonly stack: Matrix[] = [];
  private readonly candidates = new WeakMap<BloodSurface, CachedCandidate>();
  private groundY = 0;
  private readonly stains = new Map<object | number, Stain>();
  private readonly identities = new WeakMap<BloodSurface, object | number>();
  private lastTick = -1;

  /** A bone pile can remint its visible sprite without losing its local stains. */
  restore(sprite: BloodSurfaceSprite, id: number, groundY: number, lift = 0): void {
    const known = surfaceOf(sprite);
    const surface = known?.flat === true ? known : bloodSurface(sprite, groundY, { flat: true, lift });
    surface.groundY = groundY;
    surface.lift = lift;
    this.identities.set(surface, id);
    const stain = this.stains.get(id);
    if (stain === undefined) return;
    if (stain.surface === surface) return;
    surface.packed.set(stain.surface.packed);
    stain.surface = surface;
    sprite.refreshBlood();
  }

  /**
   * Bucket the contact proxies under `roots`. With `reach`, only its cells fill, and a flat or upright
   * proxy joins only when a launch row lies within its trace's row window: a caller that {@link sweep}s
   * every drop it will trace first gets the same contacts for a fraction of the walk.
   */
  prepare(roots: readonly Container[], groundY = 0, reach?: ContactReach): void {
    this.buckets.clear();
    this.groundY = groundY;
    this.reach = reach;
    for (const root of roots) {
      root.sortChildren();
      this.stackAt(0).identity();
      this.collect(root, 0);
    }
    this.reach = undefined;
  }

  /** Add the cells {@link trace} reads for `drop` launched at `(x, y)` to `into`. */
  sweep(drop: BloodDrop, x: number, y: number, into: Set<number>): void {
    const pose = this.sweepPose;
    const steps = Math.ceil(drop.flight / TRACE_STEP);
    for (let step = 1; step <= steps; step++) {
      bloodDroplet(drop, traceAge(drop, step), pose);
      into.add(cellKey(x + pose.x, y + pose.y));
    }
  }

  /** The reused matrix of walk depth `depth`; a node's matrix stays intact while its subtree reuses deeper ones. */
  private stackAt(depth: number): Matrix {
    let matrix = this.stack[depth];
    if (matrix === undefined) {
      matrix = new Matrix();
      this.stack[depth] = matrix;
    }
    return matrix;
  }

  private collect(node: Container, depth: number): void {
    if (!node.visible || !node.renderable || node.alpha <= 0) return;
    const parent = this.stackAt(depth);
    const surface = surfaceOf(node);
    // Roots carry the camera, so only their children's transforms enter world-space contacts.
    for (const child of node.children) {
      if (child.children.length === 0) {
        if (!this.bucketable(child) || isBloodless(child)) continue;
      } else if (isBloodless(child) || this.barren(child)) continue;
      child.updateLocalTransform();
      this.stackAt(depth + 1)
        .copyFrom(parent)
        .append(child.localTransform);
      this.collect(child, depth + 1);
    }
    if (surface === undefined || !surface.enabled || !(node instanceof Sprite)) return;
    const cached = this.candidateOf(surface, parent, node.bounds);
    if (cached === undefined) return;
    const { candidate, keys } = cached;
    const cells = this.reach?.cells;
    for (const key of keys) {
      if (cells !== undefined && !cells.has(key)) continue;
      const bucket = this.buckets.get(key);
      if (bucket === undefined) this.buckets.set(key, [candidate]);
      else bucket.push(candidate);
    }
  }

  /** Whether `node` carries an enabled surface a trace from the reach's rows can pass. */
  private bucketable(node: Container): boolean {
    const surface = surfaceOf(node);
    return surface?.enabled === true && this.rowReachable(surface);
  }

  /** Whether nothing under a container can bucket: neither it nor any of its children, when those are all
   *  leaves, is {@link bucketable}. Skipping it spares its transform; a container of containers is walked. */
  private barren(node: Container): boolean {
    if (this.bucketable(node)) return false;
    for (const child of node.children) {
      if (child.children.length > 0 || this.bucketable(child)) return false;
    }
    return true;
  }

  /** Whether a trace from one of the reach's rows can pass a surface's row tests; a facade's front row
   *  follows its transform, so it always can. */
  private rowReachable(surface: BloodSurface): boolean {
    const rows = this.reach?.rows;
    if (rows === undefined || surface.facade) return true;
    for (const row of rows) {
      if (Math.abs(surface.groundY - row) <= MAX_ROW_DISTANCE && (surface.flat || row >= surface.groundY))
        return true;
    }
    return false;
  }

  /** Still scenery keeps its transform between bursts, so its contact proxy is rebuilt only on change. */
  private candidateOf(
    surface: BloodSurface,
    parent: Matrix,
    bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
  ): CachedCandidate | undefined {
    const known = this.candidates.get(surface);
    if (known !== undefined && sameInputs(known, surface, parent, bounds)) return known;
    const scale = Math.sqrt(Math.abs(parent.a * parent.d - parent.b * parent.c));
    if (scale <= 0) {
      this.candidates.delete(surface);
      return undefined;
    }
    const { a, b, c, d, tx, ty } = parent;
    const x0 = a * bounds.minX + c * bounds.minY + tx;
    const y0 = b * bounds.minX + d * bounds.minY + ty;
    const x1 = a * bounds.maxX + c * bounds.minY + tx;
    const y1 = b * bounds.maxX + d * bounds.minY + ty;
    const x2 = a * bounds.maxX + c * bounds.maxY + tx;
    const y2 = b * bounds.maxX + d * bounds.maxY + ty;
    const x3 = a * bounds.minX + c * bounds.maxY + tx;
    const y3 = b * bounds.minX + d * bounds.maxY + ty;
    const top = Math.min(y0, y1, y2, y3);
    const bottom = Math.max(y0, y1, y2, y3);
    // A building anchor lies inside its footprint. Its front footing comes from the body bounds;
    // only a shallow lower band receives blood, keeping entrance awnings and roofs out of the proxy.
    const frontY = surface.facade ? Math.max(surface.groundY, bottom + surface.lift - 8) : surface.groundY;
    const contactTop = surface.facade
      ? top + (bottom - top) * surface.clipY
      : surface.groundY - surface.lift - (surface.flat ? GROUND_CONTACT_HEIGHT : MAX_CONTACT_HEIGHT);
    const candidate = { surface, inverse: parent.clone().invert(), scale, frontY, contactTop };
    const minX = Math.floor(Math.min(x0, x1, x2, x3) / BUCKET_PX);
    const maxX = Math.floor(Math.max(x0, x1, x2, x3) / BUCKET_PX);
    const minY = Math.floor(top / BUCKET_PX);
    const maxY = Math.floor(
      (bottom + (surface.facade ? MAX_ROW_DISTANCE + MAX_FACADE_DRIFT : 0)) / BUCKET_PX,
    );
    const keys: number[] = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) keys.push(bucketKey(x, y));
    const cached = {
      candidate,
      keys,
      a,
      b,
      c,
      d,
      tx,
      ty,
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      groundY: surface.groundY,
      lift: surface.lift,
      flat: surface.flat,
      facade: surface.facade,
      clipY: surface.clipY,
    };
    this.candidates.set(surface, cached);
    return cached;
  }

  trace(drop: BloodDrop, x: number, y: number, groundY = this.groundY): SurfaceContact | undefined {
    if (this.buckets.size === 0) return;
    const pose = { x: 0, y: 0, groundY: 0, angle: 0, stretch: 1, landed: false, visible: false };
    const point = new Point();
    const contactPoint = new Point();
    const local = new Point();
    // Walk the swept arc, including the landing point. Reverse painter traversal picks the front face.
    const steps = Math.ceil(drop.flight / TRACE_STEP);
    for (let step = 1; step <= steps; step++) {
      const age = traceAge(drop, step);
      bloodDroplet(drop, age, pose);
      point.set(x + pose.x, y + pose.y);
      const candidates = this.buckets.get(cellKey(point.x, point.y));
      if (candidates === undefined) continue;
      for (let i = candidates.length - 1; i >= 0; i--) {
        const candidate = candidates[i];
        if (candidate === undefined) continue;
        const { surface, inverse, scale, frontY, contactTop } = candidate;
        if (Math.abs(frontY - groundY) > MAX_ROW_DISTANCE) continue;
        // Screen overlap is not a hit through the back of a house/tree. Pre-lift rows decide sides;
        // lifted feet bound the reachable height, so terrain elevation cannot turn a roof into a wall.
        if (!surface.flat && groundY < frontY) continue;
        // Project onto the wall's ground row at the drop's current height. Direct screen overlap
        // places an impact too low when the victim stands in front of the wall.
        const contactY = surface.facade ? point.y - Math.max(0, groundY + pose.groundY - frontY) : point.y;
        if (contactY < contactTop) continue;
        if (surface.flat && !pose.landed && pose.groundY - pose.y > GROUND_CONTACT_HEIGHT) continue;
        const sprite = surface.sprite;
        const { frame, orig } = sprite.texture;
        const angle = Math.atan2(
          inverse.b * Math.cos(pose.angle) + inverse.d * Math.sin(pose.angle),
          inverse.a * Math.cos(pose.angle) + inverse.c * Math.sin(pose.angle),
        );
        contactPoint.set(point.x, contactY);
        inverse.apply(contactPoint, local);
        const px = local.x + sprite.anchor.x * orig.width;
        const py = local.y + sprite.anchor.y * orig.height;
        if (px < 0 || py < 0 || px >= frame.width || py >= frame.height) continue;
        const mask = alphaMaskOf(sprite.texture.source);
        // Unreadable art cannot prove a contact; never stop a drop on a transparent rectangle.
        if (mask === null || !maskSolidAt(mask, frame.x + Math.floor(px), frame.y + Math.floor(py))) continue;
        return {
          surface,
          x: px / frame.width,
          y: py / frame.height,
          radius: Math.min(
            MAX_RADIUS,
            (surface.flat ? 1.5 + drop.size * 1.5 : 2.5 + drop.size * 2.5) / scale,
          ),
          angle,
          age,
        };
      }
    }
    return undefined;
  }

  stamp(contact: SurfaceContact, tick: number, palette: BloodPalette = 0): void {
    const { surface, x, y, radius, angle } = contact;
    const key = this.identities.get(surface) ?? surface;
    if ((surface.sprite.destroyed && typeof key !== 'number') || !surface.enabled) return;
    let stain = this.stains.get(key);
    if (stain === undefined) stain = { surface, spots: [], tick };
    const now = Math.max(tick, stain.tick, this.lastTick);
    if (now - tick >= BLOOD_LIFETIME_TICKS) return;
    this.prune(stain, now);
    const { width, height } = surface;
    const nearby = stain.spots.find(
      (spot) =>
        spot.palette === palette &&
        Math.hypot((spot.x - x) * width, (spot.y - y) * height) < Math.max(radius, spot.radius),
    );
    if (nearby !== undefined) {
      nearby.radius = Math.min(MAX_RADIUS, Math.hypot(nearby.radius, radius * 0.6));
      // Accumulation grows a fixed imprint instead of rotating already-drawn streaks.
      nearby.tick = Math.max(nearby.tick, tick);
    } else {
      // Saturation may omit a separate new mark, but never erases a still-living patch.
      if (stain.spots.length === MAX_SPOTS) return;
      stain.spots.push({ palette, x, y, radius: Math.min(MAX_RADIUS, radius), angle, bornTick: tick, tick });
    }
    stain.tick = Math.max(stain.tick, tick);
    stain.spots.sort((a, b) => a.tick - b.tick);
    this.stains.delete(key);
    this.stains.set(key, stain);
    this.pack(stain, now);
    while (this.stains.size > MAX_BLOOD_SURFACES) {
      const oldest = this.stains.entries().next().value;
      if (oldest === undefined) break;
      this.clearSurface(oldest[1].surface);
      this.stains.delete(oldest[0]);
    }
  }

  draw(tick: number): void {
    const wholeTick = Math.floor(tick);
    if (this.lastTick === wholeTick) return;
    this.lastTick = wholeTick;
    for (const [key, stain] of this.stains) {
      if (
        tick - stain.tick >= BLOOD_LIFETIME_TICKS ||
        (typeof key !== 'number' && stain.surface.sprite.destroyed)
      ) {
        this.clearSurface(stain.surface);
        this.stains.delete(key);
      } else {
        this.prune(stain, tick);
        this.pack(stain, tick);
      }
    }
  }

  clear(): void {
    for (const stain of this.stains.values()) this.clearSurface(stain.surface);
    this.stains.clear();
    this.buckets.clear();
    this.lastTick = -1;
  }

  private clearSurface(surface: BloodSurface): void {
    surface.packed.fill(0);
    if (!surface.sprite.destroyed) surface.sprite.refreshBlood();
  }

  private pack(stain: Stain, tick: number): void {
    const data = stain.surface.packed;
    let changed = false;
    let ages = 0;
    for (let i = 0; i < MAX_SPOTS; i++) {
      const spot = stain.spots[i];
      // Exactly 24 bits: UV bytes, a 4-bit radius and 16 local directions.
      const direction = spot === undefined ? 0 : splashTurn(spot.angle);
      // Growth belongs to the first impact; fresh blood must not shrink an established imprint.
      const radius =
        spot === undefined ? 0 : spot.radius * (0.65 + 0.35 * smoothUnit((tick - spot.bornTick) / 3));
      const packed =
        spot === undefined
          ? 0
          : Math.round(spot.x * 255) +
            Math.round(spot.y * 255) * 256 +
            (Math.max(1, Math.min(MAX_RADIUS, Math.round(radius))) + direction * 16) * 65536;
      if (spot !== undefined) {
        const age = Math.max(0, tick - spot.tick);
        // Six age bits preserve fresh growth, then quantize drying; two retain each spot's pigment.
        const clock = age <= 8 ? 1 + Math.floor(age) : 9 + Math.floor((age - 8) / 23);
        const byte = clock + spot.palette * 64;
        ages += byte * 256 ** i;
      }
      if (data[i] !== packed) changed = true;
      data[i] = packed;
    }
    const packedAges = stain.surface.flat ? ages : -ages;
    if (data[3] !== packedAges) changed = true;
    data[3] = packedAges;
    if (changed && !stain.surface.sprite.destroyed) stain.surface.sprite.refreshBlood();
  }

  private prune(stain: Stain, tick: number): void {
    for (let i = stain.spots.length - 1; i >= 0; i--) {
      const spot = stain.spots[i];
      if (spot !== undefined && tick - spot.tick >= BLOOD_LIFETIME_TICKS) stain.spots.splice(i, 1);
    }
  }
}

function sameInputs(
  known: CachedCandidate,
  surface: BloodSurface,
  m: Matrix,
  bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number },
): boolean {
  return (
    known.a === m.a &&
    known.b === m.b &&
    known.c === m.c &&
    known.d === m.d &&
    known.tx === m.tx &&
    known.ty === m.ty &&
    known.minX === bounds.minX &&
    known.minY === bounds.minY &&
    known.maxX === bounds.maxX &&
    known.maxY === bounds.maxY &&
    known.groundY === surface.groundY &&
    known.lift === surface.lift &&
    known.flat === surface.flat &&
    known.facade === surface.facade &&
    known.clipY === surface.clipY
  );
}

function splashTurn(angle: number): number {
  return ((Math.round((angle * 8) / Math.PI) % 16) + 16) % 16;
}
