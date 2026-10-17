import type { HudLayout } from '@open-northland/render';
import type { Container } from 'pixi.js';
import { messages } from '../../i18n/index.js';
import { drawWindowPanel, WIN_LINE_H, WIN_PAD, WIN_TITLE_H } from '../chrome.js';
import type { Rect } from '../geometry.js';
import { liftedTop } from '../regions.js';
import type { PanelContext } from './context.js';
import { createWindowShell, type ToolWindow } from './window-shell.js';

/** Stats window width (design px). */
const STATS_WIDTH = 150;
/** Title text inset (design px). */
const TITLE_INSET_Y = 2;
/** The window title's row in the decoded `miscwindow` strings. */
const STATS_TITLE_STRING_ID = 180;

export interface StatsWindowDeps {
  readonly ctx: PanelContext;
  readonly container: Container;
}

/** The pop-up statistics window; a click anywhere inside it closes it. */
export interface StatsWindow extends ToolWindow {
  /** `hudFor` is pulled only while the window is open, because building it is an O(entities) scan. */
  refresh(hudFor: () => HudLayout): void;
}

export function createStatsWindow(deps: StatsWindowDeps): StatsWindow {
  const { ctx } = deps;
  const { scale } = ctx;
  const shell = createWindowShell(deps.container);

  /** The screen and row count the frame was drawn for, and each row's text as its run shows it. */
  let key = '';
  let shownRows: string[] = [];
  let rect: Rect | null = null;

  /** Centred in the window region; a sheet taller than the region lifts so its foot clears the beam. */
  const origin = (h: number): { x: number; y: number } => {
    const screen = ctx.screen();
    const at = ctx.layout.windowOrigin(screen, STATS_WIDTH * scale);
    return { x: at.x, y: liftedTop(at.y, h, ctx.layout.windowFloor(screen), 0) };
  };
  const screenKey = (): string => {
    const { width, height } = ctx.screen();
    return `${width}x${height}`;
  };

  const place = (): void => {
    if (rect === null) return;
    const { x: ox, y: oy } = rect;
    const { width: rw, height: rh } = ctx.screen();
    const pad = WIN_PAD * scale;
    const runs = shell.runs;
    let i = 0;
    runs[i++]?.place(ox + pad, oy + TITLE_INSET_Y * scale, scale, rw, rh);
    for (let r = 0; r < runs.length - 1; r++) {
      runs[i++]?.place(ox + pad, oy + (WIN_TITLE_H + r * WIN_LINE_H) * scale, scale, rw, rh);
    }
  };

  const rebuild = (rows: readonly string[]): void => {
    shell.clear();
    const w = STATS_WIDTH * scale;
    const h = (WIN_TITLE_H + rows.length * WIN_LINE_H + WIN_PAD) * scale;
    const { x: ox, y: oy } = origin(h);
    rect = { x: ox, y: oy, w, h };
    drawWindowPanel(shell.graphics, rect, scale);
    const title = ctx.makeText(
      ctx.uiString('miscwindow', STATS_TITLE_STRING_ID, messages().hud.statistics),
      'white',
    );
    shell.container.addChild(title.container);
    shell.runs.push(title);
    for (const text of rows) {
      const run = ctx.makeText(text, 'white');
      shell.container.addChild(run.container);
      shell.runs.push(run);
    }
    shownRows = [...rows];
    place();
  };

  /** Swap the runs of the rows whose text changed alone: the other runs and the frame stay as they are. */
  const rewrite = (rows: readonly string[]): void => {
    let changed = false;
    rows.forEach((text, row) => {
      if (shownRows[row] === text) return;
      const at = row + 1; // after the title run
      const run = ctx.makeText(text, 'white');
      shell.runs[at]?.destroy();
      shell.runs[at] = run;
      shell.container.addChild(run.container);
      shownRows[row] = text;
      changed = true;
    });
    if (changed) place();
  };

  const close = (): void => {
    shell.setOpen(false);
    shell.clear();
    rect = null;
    key = '';
  };

  return {
    isOpen: shell.isOpen,
    toggle: () => {
      if (shell.isOpen()) close();
      else shell.setOpen(true); // built on the next refresh, which supplies the rows
    },
    close,
    claims: (x, y) => shell.claims(rect, x, y),
    handleClick: (x, y): boolean => {
      if (!shell.claims(rect, x, y)) return false;
      ctx.cue('confirm'); // the whole sheet is its close button
      close();
      return true;
    },
    refresh: (hudFor): void => {
      if (!shell.isOpen()) return;
      const rows = hudFor().rows.map((r) => r.text);
      // The tick and the tallies move every tick on a busy map, so a changed row remakes its own run;
      // only a new screen or row count draws the sheet again.
      const next = `${screenKey()}|${rows.length}`;
      if (next !== key) {
        key = next;
        rebuild(rows);
        return;
      }
      rewrite(rows);
    },
  };
}
