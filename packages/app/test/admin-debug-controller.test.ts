// @vitest-environment jsdom
import type { Command } from '@open-northland/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../src/i18n/index.js';
import { mountAdminDebug } from '../src/view/admin-debug/index.js';

const copy = messages().admin;
const TILE = { col: 12, row: 34 };
const PICKED = 42;
const SEAT_TRIBE = 3;

afterEach(() => {
  document.body.replaceChildren();
});

function mount() {
  const canvas = document.createElement('canvas');
  const plane = document.createElement('div');
  document.body.append(canvas, plane);
  const sent: Command[] = [];
  const enterStandingWall = vi.fn(() => true);
  const handle = mountAdminDebug({
    canvas,
    plane,
    enqueue: (command) => sent.push(command),
    clientToTile: () => TILE,
    pickEntity: () => PICKED,
    claimPointer: () => false,
    seatTribeOf: () => SEAT_TRIBE,
    enterStandingWall,
    goods: [],
    geometryEnabled: () => false,
    setGeometryEnabled: () => undefined,
    zoomOutUnlocked: () => false,
    setZoomOutUnlocked: () => undefined,
  });
  plane.append(handle.toggle);
  const tile = (label: string): HTMLButtonElement => {
    const found = [...plane.querySelectorAll<HTMLButtonElement>('.on-admin__tile')].find((b) =>
      b.textContent?.startsWith(label),
    );
    if (found === undefined) throw new Error(`missing tile ${label}`);
    return found;
  };
  const press = (target: EventTarget, button = 0): MouseEvent => {
    const down = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
    target.dispatchEvent(down);
    target.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));
    return down;
  };
  const footer = (): string => plane.querySelector('.on-admin__status-text b')?.textContent ?? '';
  return { canvas, plane, sent, enterStandingWall, handle, tile, press, footer };
}

describe('debug tools controller', () => {
  it('drops the armed unit where the map is clicked, and a second press on its tile puts it away', () => {
    const { handle, tile, press, canvas, sent } = mount();
    handle.toggle.click();
    tile(copy.units.spear).click();
    expect(canvas.style.cursor).not.toBe('');
    press(canvas);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'spawnSettler', x: TILE.col, y: TILE.row, tribe: SEAT_TRIBE });

    tile(copy.units.spear).click();
    press(canvas);
    expect(sent).toHaveLength(1);
    expect(canvas.style.cursor).toBe('');
  });

  it('never spawns from a press on the panel itself', () => {
    const { handle, tile, press, plane, sent } = mount();
    handle.toggle.click();
    tile(copy.units.spear).click();
    press(plane.querySelector('.on-admin__body') as HTMLElement);
    expect(sent).toEqual([]);
  });

  it('puts the tool away on a right click, on Esc and when the panel closes', () => {
    const { handle, tile, press, canvas, footer } = mount();
    handle.toggle.click();
    tile(copy.units.spear).click();
    const right = press(canvas, 2);
    expect(right.defaultPrevented).toBe(true);
    expect(footer()).toBe(copy.idle);

    tile(copy.units.spear).click();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(footer()).toBe(copy.idle);

    tile(copy.units.spear).click();
    handle.toggle.click();
    expect(footer()).toBe(copy.idle);
  });

  it('renames the armed spawn when its owner changes', () => {
    const { handle, tile, plane, footer } = mount();
    handle.toggle.click();
    tile(copy.units.spear).click();
    const before = footer();
    plane.querySelectorAll<HTMLButtonElement>('.on-admin__swatch')[1]?.click();
    expect(footer()).not.toBe(before);
    expect(footer()).toContain(messages().animation.playerColors[1]);
  });

  it('hands the standing stockade to the wall tool for the chosen owner', () => {
    const { handle, tile, enterStandingWall } = mount();
    handle.toggle.click();
    tile(copy.standingPalisade).click();
    expect(enterStandingWall).toHaveBeenCalledWith(0, SEAT_TRIBE);
  });

  it('moves a picked settler to the next clicked node and waits for another pick', () => {
    const { handle, tile, press, canvas, sent, plane } = mount();
    handle.toggle.click();
    tile(copy.actions.teleport).click();
    const hint = (): string => plane.querySelector('.on-admin__status-text small')?.textContent ?? '';
    expect(hint()).toBe(copy.actionHints.teleport);
    press(canvas);
    expect(hint()).toBe(copy.hintTeleportDestination);
    press(canvas);
    expect(sent).toEqual([{ kind: 'debugTeleport', target: PICKED, x: TILE.col, y: TILE.row }]);
    expect(hint()).toBe(copy.actionHints.teleport);
  });

  it('takes its DOM and window listeners down on dispose', () => {
    const { handle, tile, press, canvas, plane, sent } = mount();
    handle.toggle.click();
    tile(copy.units.spear).click();
    handle.dispose();
    expect(canvas.style.cursor).toBe('');
    expect(plane.querySelector('.on-admin')).toBeNull();
    press(canvas);
    expect(sent).toEqual([]);
  });
});
