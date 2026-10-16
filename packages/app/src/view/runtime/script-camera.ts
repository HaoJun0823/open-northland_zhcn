import type { Camera } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';

/** A camera move a script or a briefing asks for travels at this on-screen speed, so it reads as a pan
 *  and never as a cut. Our own presentation choice; the original's pan speed is not measured. */
const GLIDE_SCREEN_PX_PER_S = 2400;
/** Bounds on one glide: a short hop still eases, a cross-map move still arrives promptly. */
const GLIDE_MIN_MS = 450;
const GLIDE_MAX_MS = 1600;
/** World-px jump between two tick anchors past which a followed human changed host (boarded, left a
 *  house) rather than moved; the camera glides to the new spot instead of lerping one tick across it. */
const FOLLOW_SNAP_PX = 128;

interface Point {
  readonly x: number;
  readonly y: number;
}

/** The world-px anchor a followed human stands at in a snapshot, or null once it is gone. */
export type AnchorOf = (snapshot: WorldSnapshot) => Point | null;

export interface ScriptCameraDeps {
  readonly camera: () => Camera;
  readonly screen: () => { readonly width: number; readonly height: number };
  /** Re-centre the view on a world-px point at the current zoom. */
  readonly centerOn: (worldX: number, worldY: number) => void;
}

export interface ScriptCamera {
  /** Glide to a world-px point and stop there; ends any follow. */
  glideTo(worldX: number, worldY: number, nowMs: number): void;
  /** Glide to a human from where it stands now, then keep it centred. */
  follow(anchorOf: AnchorOf, start: Point, nowMs: number): void;
  /** End a follow, leaving the view where it is; a glide to a point keeps going. */
  unfollow(): void;
  /** Once per drawn frame before the camera is read: `alpha` is the frame's place between two ticks. */
  frame(snapshot: WorldSnapshot, alpha: number, nowMs: number): void;
}

interface Glide {
  readonly fromX: number;
  readonly fromY: number;
  readonly startMs: number;
  readonly durationMs: number;
}

/** The followed anchor at its last two ticks, lerped by the frame alpha the way the renderer places a
 *  moving vehicle, so a followed ship holds still on screen while the world flows past. */
interface AnchorTrack {
  tick: number;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
}

type Target =
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'follow'; readonly anchorOf: AnchorOf; track: AnchorTrack | null };

const easeInOut = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/**
 * The camera a map script or briefing steers: every move eases from the current view, and a followed
 * human is tracked between ticks. A player pan, overview jump or zoom gives the view back at once.
 */
export function createScriptCamera(deps: ScriptCameraDeps): ScriptCamera {
  let target: Target | null = null;
  let glide: Glide | null = null;
  // The camera as this module last left it, so any other change reads as the player's.
  let written: Camera | null = null;

  const viewCentre = (): Point => {
    const camera = deps.camera();
    const scale = camera.scale ?? 1;
    const screen = deps.screen();
    return {
      x: (screen.width / 2 - camera.offsetX) / scale,
      y: (screen.height / 2 - camera.offsetY) / scale,
    };
  };

  const startGlide = (to: Point, nowMs: number): void => {
    const from = viewCentre();
    const screenPx = Math.hypot(to.x - from.x, to.y - from.y) * (deps.camera().scale ?? 1);
    const durationMs = Math.min(
      GLIDE_MAX_MS,
      Math.max(GLIDE_MIN_MS, (screenPx / GLIDE_SCREEN_PX_PER_S) * 1000),
    );
    glide = screenPx === 0 ? null : { fromX: from.x, fromY: from.y, startMs: nowMs, durationMs };
    written = { ...deps.camera() };
  };

  const release = (): void => {
    target = null;
    glide = null;
    written = null;
  };

  const playerMoved = (): boolean => {
    if (written === null) return false;
    // The steady camera: a script earthquake shakes only the drawn copy, so it never ends a move.
    const camera = deps.camera();
    return (
      camera.offsetX !== written.offsetX ||
      camera.offsetY !== written.offsetY ||
      camera.scale !== written.scale
    );
  };

  const followedAt = (
    follow: Extract<Target, { kind: 'follow' }>,
    snapshot: WorldSnapshot,
    alpha: number,
    nowMs: number,
  ): Point | null => {
    const at = follow.anchorOf(snapshot);
    if (at === null) return null;
    const track = follow.track;
    if (track === null) {
      follow.track = { tick: snapshot.tick, x: at.x, y: at.y, prevX: at.x, prevY: at.y };
      return at;
    }
    if (Math.abs(at.x - track.x) > FOLLOW_SNAP_PX || Math.abs(at.y - track.y) > FOLLOW_SNAP_PX) {
      follow.track = { tick: snapshot.tick, x: at.x, y: at.y, prevX: at.x, prevY: at.y };
      startGlide(at, nowMs);
      return at;
    }
    if (snapshot.tick !== track.tick) {
      track.prevX = track.x;
      track.prevY = track.y;
      track.x = at.x;
      track.y = at.y;
      track.tick = snapshot.tick;
    }
    const a = Math.min(1, Math.max(0, alpha));
    return { x: track.prevX + (track.x - track.prevX) * a, y: track.prevY + (track.y - track.prevY) * a };
  };

  return {
    glideTo(worldX, worldY, nowMs) {
      target = { kind: 'point', x: worldX, y: worldY };
      startGlide(target, nowMs);
    },
    follow(anchorOf, start, nowMs) {
      target = { kind: 'follow', anchorOf, track: null };
      startGlide(start, nowMs);
    },
    unfollow() {
      if (target?.kind === 'follow') release();
    },
    frame(snapshot, alpha, nowMs) {
      if (target === null) return;
      if (playerMoved()) {
        release();
        return;
      }
      const goal = target.kind === 'point' ? target : followedAt(target, snapshot, alpha, nowMs);
      if (goal === null) {
        release();
        return;
      }
      let { x, y } = goal;
      if (glide !== null) {
        const progress = (nowMs - glide.startMs) / glide.durationMs;
        if (progress >= 1) glide = null;
        else {
          const eased = easeInOut(Math.max(0, progress));
          x = glide.fromX + (x - glide.fromX) * eased;
          y = glide.fromY + (y - glide.fromY) * eased;
        }
      }
      deps.centerOn(x, y);
      written = { ...deps.camera() };
      if (target.kind === 'point' && glide === null) release();
    },
  };
}
