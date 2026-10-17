import { clientToCanvas } from '../../hud/geometry.js';

/** Each watched canvas's last measured box, with the backing size it was measured at: the renderer sets
 *  both at once, so a new backing size reads the box again before the resize observer reports it. The
 *  frame loop, the HUD's pointer claims and the hover read it several times a frame, and each
 *  `getBoundingClientRect` after a DOM write forces a layout. */
const measured = new WeakMap<HTMLCanvasElement, { rect: DOMRect; width: number; height: number }>();
const watched = new WeakSet<HTMLCanvasElement>();

/** Measure `canvas` again once its box may have moved: its own resize, or a window resize or scroll. */
function watch(canvas: HTMLCanvasElement): boolean {
  if (watched.has(canvas)) return true;
  if (typeof ResizeObserver === 'undefined' || typeof window === 'undefined') return false;
  const forget = (): void => {
    measured.delete(canvas);
  };
  new ResizeObserver(forget).observe(canvas);
  window.addEventListener('resize', forget);
  // Scroll does not bubble; captured, any scrolled ancestor reaches the listener.
  window.addEventListener('scroll', forget, { capture: true, passive: true });
  watched.add(canvas);
  return true;
}

function canvasRect(canvas: HTMLCanvasElement): DOMRect {
  const held = measured.get(canvas);
  if (held !== undefined && held.width === canvas.width && held.height === canvas.height) return held.rect;
  const rect = canvas.getBoundingClientRect();
  if (watch(canvas)) measured.set(canvas, { rect, width: canvas.width, height: canvas.height });
  return rect;
}

/**
 * CSS-px to Pixi-screen-px scale, with the `rect` so a caller can subtract the canvas origin in CSS px
 * before scaling. `resolution` is the renderer's device-px per screen-px; a zero-size canvas scales 1:1.
 */
export function screenScale(
  canvas: HTMLCanvasElement,
  resolution: number,
): { sx: number; sy: number; rect: DOMRect } {
  const rect = canvasRect(canvas);
  return {
    sx: rect.width === 0 ? 1 : canvas.width / resolution / rect.width,
    sy: rect.height === 0 ? 1 : canvas.height / resolution / rect.height,
    rect,
  };
}

export function clientToScreen(
  canvas: HTMLCanvasElement,
  resolution: number,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  return clientToCanvas(screenScale(canvas, resolution), clientX, clientY);
}
