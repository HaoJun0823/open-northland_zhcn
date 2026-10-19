/** A HUD plane's client box: the screen in design px (foundation.css sizes the plane by 1 / scale). */
export interface PlaneSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Each plane's size, kept by one observer: the windows and the notice column ask for it every frame,
 * where reading the plane's client box would lay out whatever the frame's HUD writes had changed. A
 * plane taken off the page reports a zero box and is forgotten then.
 */
const sizes = new Map<HTMLElement, PlaneSize>();
let observer: ResizeObserver | null = null;

const measure = (plane: HTMLElement): PlaneSize => ({ width: plane.clientWidth, height: plane.clientHeight });

export function planeSize(plane: HTMLElement): PlaneSize {
  const known = sizes.get(plane);
  if (known !== undefined) return known;
  const size = measure(plane);
  // A page without the observer (a test document) reads the box each time.
  if (typeof ResizeObserver === 'undefined') return size;
  sizes.set(plane, size);
  observer ??= new ResizeObserver((entries) => {
    for (const { target } of entries) {
      if (!(target instanceof HTMLElement)) continue;
      if (!target.isConnected) {
        observer?.unobserve(target);
        sizes.delete(target);
      } else sizes.set(target, measure(target));
    }
  });
  observer.observe(plane);
  return size;
}
