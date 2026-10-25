/** A figure as an overlay copies it: the element whose padding box the figure fills, and the canvas,
 *  kept off the page, that its painter draws on at that box's size. */
export interface FigureHolder {
  readonly node: HTMLElement;
  readonly canvas: HTMLCanvasElement;
}

/** A holder's rectangle on the overlay canvas, in its backing px. */
interface Place {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One canvas over a list's figure boxes, showing a copy of each box's figure. Chrome composites every
 * canvas on the page as a layer of its own, so a list of figures on canvases of their own costs the
 * compositor a layer each, and a scroll's fade a pass over them, every frame. The overlay is
 * positioned absolutely in the holders' offset parent.
 */
export interface FigureOverlay {
  readonly canvas: HTMLCanvasElement;
  /** Lay the canvas over `holders` and copy every one: after a relist, a re-attach, a resize or a new
   *  device scale. Reads the layout. */
  place(holders: readonly FigureHolder[]): void;
  /** Copy again the holders whose canvases the figures' paint changed. */
  copy(repainted: ReadonlySet<HTMLCanvasElement>): void;
}

export function createFigureOverlay(className: string): FigureOverlay {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.setAttribute('aria-hidden', 'true');
  const places = new Map<HTMLCanvasElement, Place>();
  let ctx: CanvasRenderingContext2D | null = null;
  /** The boxes' corner radius in backing px, which their own canvases were clipped to on the page. */
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
    place(holders) {
      places.clear();
      const nodes = holders.map((holder) => holder.node);
      const top = Math.min(...nodes.map((node) => node.offsetTop));
      const bottom = Math.max(...nodes.map((node) => node.offsetTop + node.offsetHeight));
      const left = Math.min(...nodes.map((node) => node.offsetLeft));
      const right = Math.max(...nodes.map((node) => node.offsetLeft + node.offsetWidth));
      if (nodes.length === 0 || bottom <= top || right <= left) {
        canvas.style.height = '0';
        canvas.width = 0;
        canvas.height = 0;
        return;
      }
      Object.assign(canvas.style, {
        top: `${top}px`,
        left: `${left}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
      });
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
      for (const holder of holders) {
        const rect = holder.node.getBoundingClientRect();
        const at = {
          x: Math.round((rect.left - box.left) * devicePixelRatio),
          y: Math.round((rect.top - box.top) * devicePixelRatio),
          // The holder's own canvas is painted at this size (live-figures.ts sizes it to the box).
          width: Math.round(rect.width * devicePixelRatio),
          height: Math.round(rect.height * devicePixelRatio),
        };
        places.set(holder.canvas, at);
        copyOne(holder.canvas, at);
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
