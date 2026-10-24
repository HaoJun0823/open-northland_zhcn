import { describe, expect, it } from 'vitest';
import { guiFrameIndex } from '../../../src/content/gui/atlas-map.js';
import { ACTION_COMMANDS, actionRingMenu, BOTTOM_ARM, LEFT_ARM } from '../../../src/hud/action-ring/index.js';
import { en } from '../../../src/i18n/en.js';
import { pl } from '../../../src/i18n/pl.js';

describe('action-ring command table', () => {
  it('binds every order to a real sheet frame and a tooltip in both catalogs', () => {
    for (const c of ACTION_COMMANDS) {
      expect(() => guiFrameIndex(c.icon), c.id).not.toThrow();
      expect(en.actionRing[c.id], `en ${c.id}`).toBeTypeOf('string');
      expect(pl.actionRing[c.id], `pl ${c.id}`).toBeTypeOf('string');
    }
    expect(new Set(ACTION_COMMANDS.map((c) => c.id)).size).toBe(ACTION_COMMANDS.length);
  });
});

describe('actionRingMenu', () => {
  it('keeps table order within an arm and drops arms nothing allows', () => {
    const menu = actionRingMenu(new Set(['goTo', 'haveGirl', 'attackPosition', 'attackInhabitants']));
    expect(menu.map((g) => g.arm)).toEqual([BOTTOM_ARM, LEFT_ARM]);
    expect(menu.map((g) => g.commands.map((c) => c.id))).toEqual([
      ['haveGirl', 'goTo'],
      ['attackInhabitants', 'attackPosition'],
    ]);
  });

  it('draws nothing for an empty allowance', () => {
    expect(actionRingMenu(new Set())).toEqual([]);
  });
});
