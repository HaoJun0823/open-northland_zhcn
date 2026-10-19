import { VIEWPORT } from './bench-browser-session.mjs';

/**
 * The browser benchmarks' player input: clicks and box drags with a held button, and the settler and
 * building picks they aim at. Shared by `bench:gpu` and `bench:hud`.
 */

/** A click holds the button this long, as a player's does; a bare click can miss DOM swapped under it. */
const CLICK_HOLD_MS = 120;
export const SETTLE_MS = 500;
/** Box drag steps, so the HUD sees a drag rather than a jump. */
const DRAG_STEPS = 10;
/** A settler's anchor is its feet; a click this far above lands on its body. */
const SETTLER_BODY_LIFT = 14;
/** A building's anchor is its footprint; a click this far above lands on its walls. */
const BUILDING_BODY_LIFT = 40;
/** The HUD bars' reach from each window edge at UI scale 1, by observation at 1440x900; the bars hold
 *  to the edges at any window size, and the world area is the window inside them. */
const HUD_INSET = { left: 225, top: 145, right: 225, bottom: 185 };
/** Settlers or buildings tried for a single selection before giving up. */
const SINGLE_PICK_TRIES = 30;
/** Box half-size increment, in screen pixels. */
const BOX_STEP = 5;

/** The world area clear of the HUD bars in a `viewport`-sized window. */
export function worldArea(viewport = VIEWPORT) {
  return {
    left: HUD_INSET.left,
    top: HUD_INSET.top,
    right: viewport.width - HUD_INSET.right,
    bottom: viewport.height - HUD_INSET.bottom,
  };
}

/** Screen points of drawn items of `kind` inside `area`, with their entity ids. */
export function drawnOnScreen(page, kind, area) {
  return page.evaluate(
    ({ kind, area }) => {
      const d = window.__opennorthland;
      const camera = d.cameraCtl.camera();
      const scale = camera.scale ?? 1;
      return d.renderer
        .drawnItems()
        .filter((item) => item.kind === kind)
        .map((item) => ({
          id: item.ref,
          x: item.x * scale + camera.offsetX,
          y: item.y * scale + camera.offsetY,
        }))
        .filter((p) => p.x > area.left && p.x < area.right && p.y > area.top && p.y < area.bottom);
    },
    { kind, area },
  );
}

export async function click(page, point) {
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.waitForTimeout(CLICK_HOLD_MS);
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

export async function drag(page, box) {
  await page.mouse.move(box.left, box.top);
  await page.mouse.down();
  await page.waitForTimeout(CLICK_HOLD_MS);
  for (let step = 1; step <= DRAG_STEPS; step++)
    await page.mouse.move(
      box.left + ((box.right - box.left) * step) / DRAG_STEPS,
      box.top + ((box.bottom - box.top) * step) / DRAG_STEPS,
    );
  await page.waitForTimeout(CLICK_HOLD_MS);
  await page.mouse.up();
  await page.waitForTimeout(SETTLE_MS);
}

/**
 * The one selected entity's id and whether it is a building, vehicle or settler; null unless exactly
 * one entity is selected. Reads `window.__frameInputs`, which {@link watchFrameInputs} keeps.
 */
function selectedKind(page) {
  return page.evaluate(() => {
    const { selection, selectedId } = window.__frameInputs;
    if (selection !== 1) return null;
    const entity = window.__opennorthland.host.snapshot().entities.find((e) => e.id === selectedId);
    if (entity === undefined) return null;
    if (entity.components.Building) return 'building';
    if (entity.components.Vehicle) return 'vehicle';
    return 'settler';
  });
}

/** Record what each frame hands the renderer: selection size and portrait insets. */
export function watchFrameInputs(page) {
  return page.evaluate(() => {
    const renderer = window.__opennorthland.renderer;
    const inputs = { selection: 0, selectedId: null, insets: 0 };
    window.__frameInputs = inputs;
    const update = renderer.update.bind(renderer);
    renderer.update = (frame) => {
      inputs.selection = frame.selection?.size ?? 0;
      inputs.selectedId = inputs.selection > 0 ? frame.selection.values().next().value : null;
      update(frame);
    };
    const setInsets = renderer.setPortraitInsets.bind(renderer);
    renderer.setPortraitInsets = (frames) => {
      inputs.insets = frames.length;
      setInsets(frames);
    };
  });
}

/** Click drawn settlers until one alone is selected; false when none in `area` would take. */
export async function selectOneSettler(page, area) {
  for (const settler of (await drawnOnScreen(page, 'settler', area)).slice(0, SINGLE_PICK_TRIES)) {
    await click(page, { x: settler.x, y: settler.y - SETTLER_BODY_LIFT });
    if ((await selectedKind(page)) === 'settler') return true;
  }
  return false;
}

/** Click drawn buildings until one alone is selected; false when none in `area` would take. */
export async function selectOneBuilding(page, area) {
  for (const building of (await drawnOnScreen(page, 'building', area)).slice(0, SINGLE_PICK_TRIES)) {
    await click(page, { x: building.x, y: building.y - BUILDING_BODY_LIFT });
    if ((await selectedKind(page)) === 'building') return true;
  }
  return false;
}

/** The smallest square centred on the view holding `target` of `points` inside `area`, or null. */
export function boxAround(points, target, area, viewport = VIEWPORT) {
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const reach = Math.min(center.x - area.left, center.y - area.top);
  for (let half = BOX_STEP; half <= reach; half += BOX_STEP) {
    const inside = points.filter((p) => Math.abs(p.x - center.x) <= half && Math.abs(p.y - center.y) <= half);
    if (inside.length >= target)
      return { left: center.x - half, top: center.y - half, right: center.x + half, bottom: center.y + half };
  }
  return null;
}
