// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { GroupMemberModel } from '../../../../src/hud/details-panel/model/index.js';
import { createMemberRoster } from '../../../../src/hud/dom/group-panel/members.js';

afterEach(() => document.body.replaceChildren());

/** The grid's row height and gap in design px (foundation.css `.on-roster--compact`). */
const ROW_PX = 34;
const GAP_PX = 3;
/** Past the compact threshold, so ten wells to a row. */
const MEMBERS = 200;
const COLUMNS = 10;
const VIEW_ROWS = 4;

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

describe('member roster on the page', () => {
  it('keeps a focused well focused while a scroll shifts the attached rows', () => {
    const roster = createMemberRoster(
      () => {},
      () => {},
    );
    // The page's stylesheet is not loaded here; the grid's pitch is what the roster reads.
    roster.element.style.gridAutoRows = `${ROW_PX}px`;
    roster.element.style.rowGap = `${GAP_PX}px`;
    document.body.append(roster.element);
    const members = Array.from({ length: MEMBERS }, (_, n) => settler(n + 1));
    roster.update(members, members);
    roster.setRows(VIEW_ROWS);
    const wellsAttached = (): number => roster.element.querySelectorAll('.on-roster__well').length;
    const before = wellsAttached();
    expect(before).toBeLessThan(MEMBERS);

    // A well in the fourth row stays attached after the view moves four rows down.
    const focusedRow = 3;
    const focused = roster.element.querySelectorAll<HTMLElement>('.on-roster__well')[focusedRow * COLUMNS];
    focused?.focus();
    expect(document.activeElement).toBe(focused);
    roster.element.scrollTop = VIEW_ROWS * (ROW_PX + GAP_PX);
    roster.element.dispatchEvent(new Event('scroll'));

    expect(roster.element.firstElementChild?.classList.contains('on-roster__pad')).toBe(true);
    expect(roster.element.contains(focused ?? null)).toBe(true);
    expect(document.activeElement).toBe(focused);
  });

  it('ends the hover of a well the scroll detached, which gets no mouseleave', () => {
    const roster = createMemberRoster(
      () => {},
      () => {},
    );
    roster.element.style.gridAutoRows = `${ROW_PX}px`;
    roster.element.style.rowGap = `${GAP_PX}px`;
    document.body.append(roster.element);
    const members = Array.from({ length: MEMBERS }, (_, n) => settler(n + 1));
    roster.update(members, members);
    roster.setRows(VIEW_ROWS);
    const first = roster.element.querySelector<HTMLElement>('.on-roster__well');
    first?.dispatchEvent(new Event('mouseenter'));
    expect(roster.hovered()).toBe(1);

    // Far enough that the first row leaves the attached margin.
    roster.element.scrollTop = 3 * VIEW_ROWS * (ROW_PX + GAP_PX);
    roster.element.dispatchEvent(new Event('scroll'));
    expect(roster.element.contains(first ?? null)).toBe(false);
    expect(roster.hovered()).toBeNull();
  });
});
