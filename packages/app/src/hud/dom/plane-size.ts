/** A HUD plane's client box: the screen in design px (foundation.css sizes the plane by 1 / scale). */
export interface PlaneSize {
  readonly width: number;
  readonly height: number;
}

type PlaneListener = (size: PlaneSize) => void;

interface Watch {
  size: PlaneSize;
  readonly listeners: Set<PlaneListener>;
}

/**
 * Each plane's size, kept by one observer: the windows and the notice column ask for it every frame,
 * where reading the plane's client box would lay out whatever the frame's HUD writes had changed. The
 * observer reports after the layout that resized the plane and before that frame paints, so what its
 * listeners place there shows in that frame. A plane taken off the page reports a zero box and is
 * forgotten then.
 */
const watches = new Map<HTMLElement, Watch>();
let observer: ResizeObserver | null = null;

const measure = (plane: HTMLElement): PlaneSize => ({ width: plane.clientWidth, height: plane.clientHeight });

function onResized(entries: readonly ResizeObserverEntry[]): void {
  for (const { target } of entries) {
    if (!(target instanceof HTMLElement)) continue;
    const watch = watches.get(target);
    if (watch === undefined) continue;
    if (!target.isConnected) {
      forgetPlane(target);
      continue;
    }
    watch.size = measure(target);
    for (const listener of [...watch.listeners]) listener(watch.size);
  }
}

/** The plane's watch, started on the first ask; null on a page without the observer (a test document). */
function watchOf(plane: HTMLElement): Watch | null {
  const known = watches.get(plane);
  if (known !== undefined) return known;
  if (typeof ResizeObserver === 'undefined') return null;
  const watch: Watch = { size: measure(plane), listeners: new Set() };
  watches.set(plane, watch);
  observer ??= new ResizeObserver(onResized);
  observer.observe(plane);
  return watch;
}

/** Forget a plane its HUD takes down, without waiting for the observer's zero-box report. */
export function forgetPlane(plane: HTMLElement): void {
  if (!watches.delete(plane)) return;
  observer?.unobserve(plane);
}

export function planeSize(plane: HTMLElement): PlaneSize {
  return watchOf(plane)?.size ?? measure(plane);
}

/** Run `listener` with the plane's new size each time the observer reports it; the answer stops it. */
export function onPlaneResize(plane: HTMLElement, listener: PlaneListener): () => void {
  const watch = watchOf(plane);
  if (watch === null) return () => undefined;
  watch.listeners.add(listener);
  return () => {
    watch.listeners.delete(listener);
  };
}
