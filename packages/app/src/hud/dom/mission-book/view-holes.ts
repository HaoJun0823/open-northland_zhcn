import type { MapViewTarget } from '@open-northland/render';
import type { ClientRect } from '../portrait-hole.js';
import type { ViewSlot } from './markup.js';

/** One world view the open book shows: its box and the part of it inside the page, in client px. */
export interface BookView {
  /** The view's slot in the page's flow (`data-view`). */
  readonly slot: number;
  readonly box: ClientRect;
  readonly clip: ClientRect;
  /** The box's width in design px, which sets the world's scale in it. */
  readonly designW: number;
  readonly target: MapViewTarget;
  /** Where the target lands, design px from the box's top-left. */
  readonly focusX: number;
  readonly focusY: number;
  readonly zoom: number;
  readonly soloFill?: number;
  /** A canvas the renderer copies the drawn view into this frame. */
  readonly still?: HTMLCanvasElement;
}

function intersect(a: ClientRect, b: ClientRect): ClientRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

/**
 * The world views on the shown spread, read off the laid-out page with their visible part. A view
 * outside its page window (another spread's column) is left out. Reads the layout: it runs on a
 * layout change, never per frame.
 */
export function measureViews(
  spread: HTMLElement,
  slots: readonly ViewSlot[],
  k: number,
): readonly BookView[] {
  const views: BookView[] = [];
  for (const lens of spread.querySelectorAll<HTMLElement>('.on-book__lens')) {
    const index = Number(lens.parentElement?.dataset.view);
    const slot = slots[index];
    const win = lens.closest<HTMLElement>('.on-book__window');
    const target = slot?.icon.target ?? null;
    if (slot === undefined || target === null || win === null) continue;
    const outer = lens.getBoundingClientRect();
    const box: ClientRect = {
      left: outer.left + lens.clientLeft * k,
      top: outer.top + lens.clientTop * k,
      width: lens.clientWidth * k,
      height: lens.clientHeight * k,
    };
    const clip = intersect(box, win.getBoundingClientRect());
    if (clip === null) continue;
    const { icon, zoom } = slot;
    const designW = lens.clientWidth;
    const designH = lens.clientHeight;
    views.push({
      slot: index,
      box,
      clip,
      designW,
      target,
      // A map view centres its target; a card keeps the figure's feet where the original's did.
      focusX: icon.soloFill === undefined ? designW / 2 : icon.focusX * zoom,
      focusY: icon.soloFill === undefined ? designH / 2 + (icon.focusY - icon.h / 2) : icon.focusY * zoom,
      zoom,
      ...(icon.soloFill !== undefined ? { soloFill: icon.soloFill } : {}),
    });
  }
  return views;
}

const MASK_PROPERTIES = [
  'mask-image',
  'mask-size',
  'mask-position',
  'mask-repeat',
  'mask-composite',
] as const;

/**
 * Cut `clips` (client px) out of `layer`, so the canvas the renderer paints under them shows through
 * it: every hole is one mask layer, excluded from a whole layer under them all.
 */
export function maskHoles(layer: HTMLElement, clips: readonly ClientRect[]): void {
  if (clips.length === 0) {
    for (const property of MASK_PROPERTIES) layer.style.removeProperty(property);
    return;
  }
  layer.style.setProperty('mask-repeat', 'no-repeat');
  layer.style.setProperty('mask-composite', 'exclude');
  const origin = layer.getBoundingClientRect();
  // Client px per px of the layer's own box: the plane's scale, times the book's inside it.
  const k = layer.offsetWidth === 0 ? 1 : origin.width / layer.offsetWidth;
  const whole = 'linear-gradient(#000 0 0)';
  layer.style.setProperty('mask-image', [...clips.map(() => whole), whole].join(', '));
  layer.style.setProperty(
    'mask-size',
    [...clips.map((c) => `${c.width / k}px ${c.height / k}px`), '100% 100%'].join(', '),
  );
  layer.style.setProperty(
    'mask-position',
    [...clips.map((c) => `${(c.left - origin.left) / k}px ${(c.top - origin.top) / k}px`), '0 0'].join(', '),
  );
}

export interface UnderlayCut {
  /** Cut `clips` (client px) out of the regions under the owner; an empty list closes every hole. */
  cut(clips: readonly ClientRect[]): void;
  dispose(): void;
}

function zIndexOf(element: HTMLElement): number {
  const z = Number.parseInt(getComputedStyle(element).zIndex, 10);
  return Number.isNaN(z) ? 0 : z;
}

/** The regions of `owner`'s plane painted under it. */
function regionsUnder(owner: HTMLElement): HTMLElement[] {
  const plane = owner.parentElement;
  if (plane === null) return [];
  const ownerZ = zIndexOf(owner);
  const under: HTMLElement[] = [];
  let beforeOwner = true;
  for (const child of plane.children) {
    if (child === owner) {
      beforeOwner = false;
      continue;
    }
    if (!(child instanceof HTMLElement)) continue;
    const z = zIndexOf(child);
    if (z < ownerZ || (z === ownerZ && beforeOwner)) under.push(child);
  }
  return under;
}

/**
 * A hole in `owner` shows whatever lies under it, so a HUD region between the canvas and `owner`
 * (the admin panel under the book) would show in the hole instead of the world. This cuts the owner's holes out
 * of those regions as well, again whenever a region of the plane appears, leaves or resizes. Reads the
 * layout on those changes only, never per frame; a region that moves without resizing keeps its cut.
 */
export function createUnderlayCut(owner: HTMLElement): UnderlayCut {
  let clips: readonly ClientRect[] = [];
  const masked = new Set<HTMLElement>();

  const apply = (): void => {
    const under = new Set(clips.length === 0 ? [] : regionsUnder(owner));
    for (const region of masked) {
      if (under.has(region)) continue;
      maskHoles(region, []);
      masked.delete(region);
    }
    for (const region of under) {
      const box = region.getBoundingClientRect();
      const over = clips.filter((clip) => intersect(clip, box) !== null);
      if (over.length > 0) {
        maskHoles(region, over);
        masked.add(region);
      } else if (masked.delete(region)) maskHoles(region, []);
    }
  };

  const resizes = new ResizeObserver(apply);
  const observeRegions = (): void => {
    for (const child of owner.parentElement?.children ?? []) if (child !== owner) resizes.observe(child);
  };
  const arrivals = new MutationObserver(() => {
    observeRegions();
    apply();
  });

  return {
    cut(next): void {
      const opening = clips.length === 0 && next.length > 0;
      clips = next;
      if (next.length === 0) {
        resizes.disconnect();
        arrivals.disconnect();
      } else if (opening) {
        const plane = owner.parentElement;
        if (plane !== null) arrivals.observe(plane, { childList: true });
        observeRegions();
      }
      apply();
    },
    dispose(): void {
      resizes.disconnect();
      arrivals.disconnect();
      clips = [];
      apply();
    },
  };
}
