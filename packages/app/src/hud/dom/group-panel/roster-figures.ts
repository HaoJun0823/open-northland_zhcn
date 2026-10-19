import type { FigureWell } from '../parts/figure-well.js';

/** A well's rectangle on the figure canvas, in its backing px. */
interface Place {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The roster's one canvas for its members' figures. Each well still paints its figure on its own canvas,
 * kept off the page (foundation.css), and this canvas over the laid wells takes a copy at the well's
 * place. Chrome composites every canvas on the page as a layer of its own, so a big army's wells cost
 * the compositor a layer each, and the scroll's fade a pass over them, every frame.
 */
export interface RosterFigures {
  readonly canvas: HTMLCanvasElement;
  /** Lay the canvas over `wells` and copy every one: after a relist, a scroll or a resize. Reads the
   *  layout. */
  place(wells: readonly FigureWell[]): void;
  /** Copy again the wells whose canvases the figures' paint changed. */
  copy(repainted: ReadonlySet<HTMLCanvasElement>): void;
}

export function createRosterFigures(): RosterFigures {
  const canvas = document.createElement('canvas');
  canvas.className = 'on-roster__figures';
  canvas.setAttribute('aria-hidden', 'true');
  const places = new Map<HTMLCanvasElement, Place>();
  let ctx: CanvasRenderingContext2D | null = null;
  /** The wells' corner radius in backing px, which their own canvases were clipped to on the page. */
  let radius = 0;

  const copyOne = (source: HTMLCanvasElement, at: Place): void => {
    if (ctx === null) return;
    ctx.clearRect(at.x, at.y, at.width, at.height);
    if (source.width === 0 || source.height === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(at.x, at.y, at.width, at.height, radius);
    ctx.clip();
    ctx.drawImage(source, at.x, at.y);
    ctx.restore();
  };

  return {
    canvas,
    place(wells) {
      places.clear();
      const nodes = wells.map((well) => well.node);
      const top = nodes.length === 0 ? 0 : Math.min(...nodes.map((node) => node.offsetTop));
      const bottom =
        nodes.length === 0 ? 0 : Math.max(...nodes.map((node) => node.offsetTop + node.offsetHeight));
      if (bottom <= top) {
        canvas.style.height = '0';
        canvas.width = 0;
        canvas.height = 0;
        return;
      }
      canvas.style.top = `${top}px`;
      canvas.style.height = `${bottom - top}px`;
      // Client rects carry the plane's scale; device px make the copies land on whole pixels.
      const box = canvas.getBoundingClientRect();
      canvas.width = Math.round(box.width * devicePixelRatio);
      canvas.height = Math.round(box.height * devicePixelRatio);
      ctx ??= canvas.getContext('2d');
      const first = nodes[0];
      const scale = box.height === 0 ? 0 : canvas.height / (bottom - top);
      radius =
        first === undefined
          ? 0
          : (Number.parseFloat(getComputedStyle(first).borderTopLeftRadius) || 0) * scale;
      for (const well of wells) {
        const rect = well.node.getBoundingClientRect();
        const at = {
          x: Math.round((rect.left - box.left) * devicePixelRatio),
          y: Math.round((rect.top - box.top) * devicePixelRatio),
          // The well's own canvas is painted at this size (live-figures.ts sizes it to the well).
          width: Math.round(rect.width * devicePixelRatio),
          height: Math.round(rect.height * devicePixelRatio),
        };
        places.set(well.canvas, at);
        copyOne(well.canvas, at);
      }
    },
    copy(repainted) {
      for (const source of repainted) {
        const at = places.get(source);
        if (at !== undefined) copyOne(source, at);
      }
    },
  };
}
