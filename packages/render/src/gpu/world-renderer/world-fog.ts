import { FOG_STATE, type FogView, systems, type WorldSnapshot } from '@open-northland/sim';
import type { Container } from 'pixi.js';
import {
  type FogGhostMemory,
  FogGhostStore,
  fogTileExplored,
  fogTileVisible,
  type GhostSource,
} from '../../data/fog/index.js';
import type { Viewport } from '../../data/projection/index.js';
import type { ElevationField } from '../../data/terrain/index.js';
import { FogLayer, type FogWashMask } from '../overlays/index.js';
import type { PoolFrame } from '../sprite-pool/index.js';

/**
 * The viewer's fog as one owner: every consumer reads the same `FogView` within a frame, so they cannot
 * disagree about a cell.
 */

export type FogPoolFrame = Pick<PoolFrame, 'staticRefs' | 'fogVisible' | 'fogEpoch' | 'ghosts'>;

export class WorldFog {
  private readonly wash = new FogLayer();
  private view: FogView | null = null;
  private readonly ghosts = new FogGhostStore();
  private staticRefs: ReadonlySet<number> | undefined;
  /** Bumped when the cull's answers may change: a mask rebuild (`generation`), a seat switch
   *  (`player`) or a mode remap of `stateAt`. Consumers key their per-frame caches on it instead of
   *  re-probing a steady mask. */
  private epoch = 0;
  private lastGeneration = -1;
  private lastPlayer: number | null = null;
  private lastMode: FogView['mode'] | null = null;
  private sight = 0;
  /** Bound once: the pool's cull predicate reads the live view, so a frame allocates no closure. */
  private readonly visibleAt = (tileX: number, tileY: number): boolean =>
    this.view === null || fogTileVisible(this.view, tileX, tileY);

  private readonly exploredAt = (tileX: number, tileY: number): boolean =>
    this.view === null || fogTileExplored(this.view, tileX, tileY);

  /** The explored-ground gate for marks that lie on the land like its objects; unset while fog is off. */
  get exploredGate(): ((tileX: number, tileY: number) => boolean) | undefined {
    return this.view === null ? undefined : this.exploredAt;
  }

  get container(): Container {
    return this.wash.container;
  }

  /** The wash's texture and band, rewritten in place as the fog redraws. */
  get washMask(): FogWashMask {
    return this.wash.mask;
  }

  /** The tall map-object gate: this view's per-cell state, `undefined` while fog is off. */
  get cellStateAt(): FogView['stateAt'] | undefined {
    return this.view?.stateAt;
  }

  setView(view: FogView | null): void {
    const was = this.view;
    const changed =
      view === null || was === null
        ? view !== was
        : view.generation !== was.generation || view.player !== was.player || view.mode !== was.mode;
    if (changed) this.sight++;
    this.view = view;
  }

  /** Whether the viewer watches the cell of half-cell node (hx, hy); fog off watches everything. */
  seesNode(hx: number, hy: number): boolean {
    if (this.view === null) return true;
    const { cx, cy } = systems.cellOfNode(hx, hy);
    return this.view.stateAt(cx, cy) === FOG_STATE.VISIBLE;
  }

  /** Bumps whenever {@link seesNode} may answer differently, the moment a view is set. */
  get sightRevision(): number {
    return this.sight;
  }

  knowStartBuildings(): void {
    this.ghosts.knowStartBuildings();
  }

  restoreMemory(memory: FogGhostMemory): void {
    this.ghosts.restore(memory);
  }

  savedMemory(): FogGhostMemory | null {
    return this.ghosts.memory();
  }

  /** The remembered statics the world draws on explored ground, as of the last {@link update}. */
  get memory(): GhostSource {
    return this.ghosts;
  }

  /** Live view: the caller keeps shrinking this same set as nodes are first worked and never
   *  re-passes it (the handover seam's shrink-only contract). */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void {
    this.staticRefs = refs;
  }

  /** Recomposite the wash for one frame and return the pool's fog inputs. Both passes cache on the mask
   *  generation, so a steady frame does no work. */
  update(snapshot: WorldSnapshot, vp: Viewport, elevation?: ElevationField): FogPoolFrame {
    const view = this.view;
    const staticRefs = this.staticRefs;
    this.wash.update(view, vp, elevation);
    if (view === null) {
      this.ghosts.clear();
      return staticRefs === undefined ? {} : { staticRefs };
    }
    if (
      view.generation !== this.lastGeneration ||
      view.player !== this.lastPlayer ||
      view.mode !== this.lastMode
    ) {
      this.epoch++;
      this.lastGeneration = view.generation;
      this.lastPlayer = view.player;
      this.lastMode = view.mode;
    }
    this.ghosts.update(snapshot, view, staticRefs, elevation);
    return {
      ...(staticRefs !== undefined ? { staticRefs } : {}),
      fogVisible: this.visibleAt,
      fogEpoch: this.epoch,
      ghosts: this.ghosts,
    };
  }

  destroy(): void {
    this.wash.destroy();
  }
}
