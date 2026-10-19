// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GroupMemberModel } from '../src/hud/details-panel/model/index.js';
import { createMemberRoster, type MemberRoster } from '../src/hud/dom/group-panel/members.js';

/** The compact grid: wells 24 x 34 design px, ten to a row, 3 px apart (foundation.css). */
const WELL_W = 24;
const WELL_H = 34;
const GAP_PX = 3;
const COLUMNS = 10;
const MEMBERS = 200;
const VIEW_ROWS = 4;
/** The roster's content width the figure canvas spans. */
const ROSTER_W = COLUMNS * (WELL_W + GAP_PX);

const settler = (id: number): GroupMemberModel => ({
  id,
  look: 'settler',
  kind: 'settler',
  name: `Settler ${id}`,
  kindLabel: 'settler',
  healthPct: 100,
  hungerPct: 100,
  carriesMead: false,
});

/** Where a laid well sits: its place among the roster's wells, after the rows scrolled away above it. */
function wellBox(well: HTMLElement): { left: number; top: number } {
  const wells = [...(well.parentElement?.querySelectorAll(':scope > .on-roster__well') ?? [])];
  const index = wells.indexOf(well);
  return {
    left: (index % COLUMNS) * (WELL_W + GAP_PX),
    top: Math.floor(index / COLUMNS) * (WELL_H + GAP_PX),
  };
}

let placements = 0;
const drawn: [number, number][] = [];

/** jsdom lays nothing out: the wells report their grid boxes, the figure canvas its own box, and every
 *  canvas a context that records where it is drawn. */
function fakeLayout(): void {
  const button = HTMLButtonElement.prototype;
  for (const [name, value] of [
    ['offsetWidth', WELL_W],
    ['clientWidth', WELL_W],
    ['clientHeight', WELL_H],
    ['offsetHeight', WELL_H],
  ] as const)
    Object.defineProperty(button, name, { configurable: true, get: () => value });
  Object.defineProperty(button, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return wellBox(this).top;
    },
  });
  vi.spyOn(button, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const { left, top } = wellBox(this);
    return { left, top, width: WELL_W, height: WELL_H } as DOMRect;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => {
    placements++;
    return { left: 0, top: 0, width: ROSTER_W, height: VIEW_ROWS * (WELL_H + GAP_PX) } as DOMRect;
  });
  // The spy types the fake as getContext's last overload; the roster only asks for '2d'.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        clearRect: () => undefined,
        save: () => undefined,
        restore: () => undefined,
        beginPath: () => undefined,
        roundRect: () => undefined,
        clip: () => undefined,
        drawImage: (_source: unknown, x: number, y: number) => drawn.push([x, y]),
      }) as never,
  );
}

/** One frame as the panel runs it: the painter draws every slot at its size, then the roster copies. */
function frame(roster: MemberRoster, repaint = true): void {
  const slots = roster.figureSlots();
  const repainted = new Set<HTMLCanvasElement>();
  for (const slot of slots) {
    if (!repaint) continue;
    slot.canvas.width = Math.round(slot.box.width * slot.box.pixelScale);
    slot.canvas.height = Math.round(slot.box.height * slot.box.pixelScale);
    repainted.add(slot.canvas);
  }
  roster.markDrawn(new Set(slots.map((slot) => slot.entity)), repainted);
}

function laidRoster(): MemberRoster {
  const roster = createMemberRoster(
    () => {},
    () => {},
  );
  // The page's stylesheet is not loaded here; the grid's pitch is what the roster reads.
  roster.element.style.gridAutoRows = `${WELL_H}px`;
  roster.element.style.rowGap = `${GAP_PX}px`;
  document.body.append(roster.element);
  const members = Array.from({ length: MEMBERS }, (_, n) => settler(n + 1));
  roster.update(members, members);
  roster.setRows(VIEW_ROWS);
  return roster;
}

const figureCanvas = (roster: MemberRoster): HTMLCanvasElement | null =>
  roster.element.querySelector<HTMLCanvasElement>('canvas.on-roster__figures');

describe('roster figure canvas', () => {
  beforeEach(() => {
    placements = 0;
    drawn.length = 0;
    fakeLayout();
    vi.stubGlobal('devicePixelRatio', 1);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const name of ['offsetWidth', 'clientWidth', 'clientHeight', 'offsetHeight', 'offsetTop'])
      Reflect.deleteProperty(HTMLButtonElement.prototype, name);
    document.body.replaceChildren();
  });

  it('lays the canvas again at a new device scale, so the copies keep their size and place', () => {
    const roster = laidRoster();
    frame(roster);
    expect(figureCanvas(roster)?.width).toBe(ROSTER_W);
    // A window moved to a display of twice the density: the wells' canvases double, and so must
    // the canvas their copies land on, with every place.
    vi.stubGlobal('devicePixelRatio', 2);
    drawn.length = 0;
    frame(roster);
    expect(figureCanvas(roster)?.width).toBe(2 * ROSTER_W);
    expect(drawn[1]).toEqual([2 * (WELL_W + GAP_PX), 0]);
  });

  it('keeps its place through a scroll that leaves the laid rows as they were', () => {
    const roster = laidRoster();
    frame(roster);
    const laid = placements;
    roster.element.scrollTop = 1;
    roster.element.dispatchEvent(new Event('scroll'));
    frame(roster, false);
    expect(placements).toBe(laid);
    // Far enough that other rows are laid: the canvas follows them.
    roster.element.scrollTop = 3 * VIEW_ROWS * (WELL_H + GAP_PX);
    roster.element.dispatchEvent(new Event('scroll'));
    frame(roster, false);
    expect(placements).toBeGreaterThan(laid);
  });
});
