import type { WorkerRefusalReason } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { idleNoteType } from '../../../../src/hud/tool-panel/messages/idle-reasons.js';
import {
  composeMessageText,
  fightSummary,
  type MessageText,
  type MessageTextParts,
  type NoticeCopy,
  userMessageTypeName,
} from '../../../../src/hud/tool-panel/messages/text.js';
import {
  type IdleReasonKind,
  type ProductionStallReason,
  USER_MESSAGE_TYPE,
  type UserMessageTypeName,
} from '../../../../src/hud/tool-panel/messages/types.js';
import { en } from '../../../../src/i18n/en.js';
import { pl } from '../../../../src/i18n/pl.js';

/** The most characters a card line's own words may take, placeholders left out: a proxy for the stacked
 *  column's one 93 px line at 1080p, where 14 Polish characters measured 92 px and 16 English ones 84. */
const SHORT_LINE_MAX_CHARS = 16;
const PLACEHOLDER = /\{[A-Za-z]+\}/g;
const WOOD = 4;
const STONE = 5;

const COPIES: readonly (readonly [string, NoticeCopy])[] = [
  ['pl', pl.userMessages],
  ['en', en.userMessages],
];

const BARE: MessageTextParts = { subjectName: 'Bjorn', jobLabel: null, goodName: null, stanceName: null };

/** Every part a type can name, so no placeholder is left for want of a value. */
function partsFor(name: UserMessageTypeName, female: boolean): MessageTextParts {
  return {
    ...BARE,
    jobLabel: female ? null : 'Rolnik',
    female,
    goodName: 'Chleb',
    stanceName: 'wrogi',
    detail: 'Prolongata',
    settings: ['Skala renderowania', 'Język'],
    technologySections: { jobs: ['Młynarz'], goods: [], houses: [], vehicles: [] },
    training: { course: 'school', profession: 'Młynarz' },
    stall: 'noInputSource',
    refusal: { reason: 'experience', building: 'Młyn', profession: 'Młynarz' },
    ...(name === 'familyBlocked'
      ? { family: { wait: 'livesApart', partner: { name: 'Olaf', jobLabel: 'Zwiadowca', female: false } } }
      : {}),
    fight: { buildings: 1, walls: 0, settlers: 0, vehicles: 0, enemies: ['Gracz 2'], wild: false },
  };
}

function composeIn(copy: NoticeCopy, tag: string, name: UserMessageTypeName, parts: MessageTextParts) {
  return composeMessageText(USER_MESSAGE_TYPE[name], parts, copy, tag);
}

function compose(copy: NoticeCopy, name: UserMessageTypeName, parts: MessageTextParts): MessageText {
  return composeMessageText(USER_MESSAGE_TYPE[name], parts, copy);
}

/** Every card line a catalog holds, per key: one per type, plus the variants and the family waits. */
function shortLines(copy: NoticeCopy): Map<string, Set<string>> {
  const lines = new Map<string, Set<string>>();
  for (const [key, line] of Object.entries(copy.short)) {
    lines.set(key, new Set(typeof line === 'string' ? [line] : [line.he, line.she]));
  }
  for (const [wait, line] of Object.entries(copy.familyBlocked.short))
    lines.set(`family:${wait}`, new Set([line]));
  for (const [reason, line] of Object.entries(copy.productionStalled.short))
    lines.set(`stall:${reason}`, new Set([line]));
  for (const [reason, line] of Object.entries(copy.workerRefused.short))
    lines.set(`refusal:${reason}`, new Set([line]));
  return lines;
}

describe('notice text', () => {
  it.each(COPIES)(
    'words every type in %s from the catalog alone, every placeholder filled',
    (_lang, copy) => {
      for (const name of Object.keys(USER_MESSAGE_TYPE) as UserMessageTypeName[]) {
        for (const female of [false, true]) {
          const text = compose(copy, name, partsFor(name, female));
          for (const line of [text.short, text.full]) {
            expect(line, name).not.toMatch(PLACEHOLDER);
            expect(line, name).not.toMatch(/[—–]| {2}/);
            expect(line.trim(), name).not.toBe('');
          }
          // An idle reason and the experience lists follow the full text as sentences of their own.
          expect(text.full.split('\n')[0], name).toMatch(/\.$/);
        }
      }
    },
  );

  it.each(COPIES)('gives every type in %s its own card line, short enough for one line', (_lang, copy) => {
    const owner = new Map<string, string>();
    for (const [key, lines] of shortLines(copy)) {
      for (const line of lines) {
        expect(owner.get(line), `"${line}" on ${key}`).toBeUndefined();
        owner.set(line, key);
        expect(line.replace(PLACEHOLDER, '').trim().length, line).toBeLessThanOrEqual(SHORT_LINE_MAX_CHARS);
      }
    }
  });

  it('agrees the Polish wording with the settler’s sex and leads with the name and trade', () => {
    const he = compose(pl.userMessages, 'grewUp', { ...BARE, jobLabel: 'Rolnik', female: false });
    const she = compose(pl.userMessages, 'grewUp', { ...BARE, subjectName: 'Astrid', female: true });
    expect(he.short).not.toBe(she.short);
    expect(he.full.startsWith('Bjorn (Rolnik) dorósł')).toBe(true);
    expect(she.full.startsWith('Astrid dorosła')).toBe(true);
  });

  it('reports a death it cannot name with its own lines', () => {
    expect(compose(en.userMessages, 'humanDied', { ...BARE, subjectName: null })).toEqual({
      short: en.userMessages.short.humanDiedUnknown,
      full: en.userMessages.full.humanDiedUnknown,
    });
    expect(compose(en.userMessages, 'humanDied', BARE).full).toBe('Bjorn has died.');
  });

  it('tells a barracks course from a school one', () => {
    const course = (training: NonNullable<MessageTextParts['training']>) =>
      compose(pl.userMessages, 'canDoNewJob', { ...BARE, training });
    const barracks = course({ course: 'barracks', profession: 'Żołnierz' });
    const school = course({ course: 'school', profession: 'Młynarz' });
    expect(barracks.short).not.toBe(school.short);
    expect(school.full).toContain('Młynarz');
  });

  it('lists an experience unlock under one heading per kind, leaving empty kinds out', () => {
    const text = compose(en.userMessages, 'experienceUnlocks', {
      ...BARE,
      technologySections: { jobs: ['Miller'], goods: ['Flour', 'Bread'], houses: [], vehicles: [] },
    });
    expect(text.full).toBe(
      'Bjorn has gained experience.\n\nNew professions:\n- Miller\n\nNew goods:\n- Flour\n- Bread',
    );
  });

  it('heads an unlock that opens buildings as such, and lists every one in full', () => {
    const opening = (houses: string[]) => ({
      ...BARE,
      technologySections: { jobs: [], goods: [], houses, vehicles: [] },
    });
    const two = compose(en.userMessages, 'experienceUnlocks', opening(['Pottery', 'School']));
    expect(two.short).toBe('New buildings');
    expect(two.full).toBe('Bjorn has gained experience.\n\nNew buildings:\n- Pottery\n- School');
    expect(compose(pl.userMessages, 'experienceUnlocks', opening(['Garncarnia'])).short).toBe('Nowy budynek');
  });

  it('lists vehicle build sites as vehicles, under their own heading', () => {
    const text = compose(pl.userMessages, 'experienceUnlocks', {
      ...BARE,
      technologySections: { jobs: [], goods: [], houses: ['Szkoła'], vehicles: ['Wózek'] },
    });
    expect(text.short).toBe('Nowy budynek');
    expect(text.full).toBe(
      'Bjorn zdobył doświadczenie.\n\nNowe budynki:\n- Szkoła\n\nNowe wehikuły:\n- Wózek',
    );
    const carts = compose(en.userMessages, 'experienceUnlocks', {
      ...BARE,
      technologySections: { jobs: [], goods: [], houses: [], vehicles: ['Handcart', 'Oxcart'] },
    });
    expect(carts.short).toBe('New vehicles');
  });

  it('words a stalled workshop by its reason and names the good, or points at the panel without one', () => {
    const stall = (reason: ProductionStallReason) =>
      compose(pl.userMessages, 'productionStalled', {
        ...BARE,
        subjectName: 'Młyn',
        goodName: 'Zboże',
        stall: reason,
      });
    expect(stall('noInputSource').full).toContain('Zboże');
    expect(stall('noCollector').full).not.toBe(stall('noInputSource').full);
    expect(stall('unknown').full).not.toContain('Zboże');
  });

  it('names the workplace and the trade of a refused worker order', () => {
    const refused = (reason: WorkerRefusalReason) =>
      compose(pl.userMessages, 'workerRefused', {
        ...BARE,
        refusal: { reason, building: 'Młyn', profession: 'Młynarz' },
      });
    expect(refused('experience').full).toContain('Młynarz');
    expect(refused('full').full).toContain('Młyn');
  });

  it.each(COPIES)('words every idle reason in %s, and a worker the sim gives none', (_lang, copy) => {
    const kinds = Object.keys(copy.idleReason.short) as IdleReasonKind[];
    expect(new Set(kinds)).toEqual(new Set(Object.keys(copy.idleReason.full)));
    expect(new Set(kinds)).toEqual(new Set(Object.keys(copy.idleReason.withoutGood)));
    expect(new Set(Object.values(copy.idleReason.short)).size).toBe(kinds.length);
    const cases = [...kinds.map((kind) => ({ kind, goodTypes: [4] })), null].flatMap((idle) =>
      ['Chleb', null].map((goodName) => ({ idle, goodName })),
    );
    for (const { idle, goodName } of cases) {
      for (const female of [false, true]) {
        const name = userMessageTypeName(idleNoteType(idle));
        const text = compose(copy, name, { ...BARE, female, goodName, idle });
        for (const line of [text.short, text.full]) {
          expect(line, idle?.kind).not.toMatch(PLACEHOLDER);
          expect(line, idle?.kind).not.toMatch(/[—–]| {2}|: ?[.,]|:$/);
        }
        expect(text.short.replace('Chleb', '').trim().length, text.short).toBeLessThanOrEqual(
          SHORT_LINE_MAX_CHARS,
        );
        expect(text.full).toMatch(/\.$/);
      }
    }
  });

  it('names the goods an idle worker found none of', () => {
    const idle = { kind: 'noResourceInArea', goodTypes: [WOOD, STONE] } as const;
    const text = compose(pl.userMessages, userMessageTypeName(idleNoteType(idle)), {
      ...BARE,
      goodName: 'Drewno, Kamień',
      idle,
    });
    expect(text.full).toContain('Drewno, Kamień');
  });

  it("counts a fight's hit bodies in the catalog's plural forms and names who struck", () => {
    const NAMELESS = { ...BARE, subjectName: null };
    const raid = composeIn(pl.userMessages, 'pl', 'settlementAttacked', {
      ...NAMELESS,
      fight: { buildings: 2, walls: 3, settlers: 1, vehicles: 5, enemies: ['Gracz 2'], wild: false },
    });
    expect(raid.full).toContain(
      'Wróg: Gracz 2. Zaatakowano: 2 budynki, 3 odcinki palisady, 1 osadnika, 5 wehikułów.',
    );
    const wolves = composeIn(en.userMessages, 'en', 'peopleAttacked', {
      ...NAMELESS,
      fight: { buildings: 0, walls: 0, settlers: 3, vehicles: 0, enemies: [], wild: true },
    });
    expect(wolves.full).toContain('Enemy: wild beasts. Hit: 3 settlers.');
  });

  it('sums a fight up for its row in a stack: who struck, then what they hit', () => {
    const fight = { buildings: 2, walls: 0, settlers: 1, vehicles: 0, enemies: ['Gracz 2'], wild: true };
    expect(fightSummary(fight, pl.userMessages, 'pl')).toBe('Gracz 2, dzikie bestie · 2 budynki, 1 osadnika');
    expect(fightSummary({ ...fight, buildings: 0, settlers: 0 }, en.userMessages, 'en')).toBe(
      'Gracz 2, wild beasts',
    );
  });

  it('names the husband where the reason is his, and reads cleanly when he cannot be named', () => {
    const family = (partner: { name: string; jobLabel: string | null; female: boolean } | null) =>
      compose(pl.userMessages, 'familyBlocked', {
        ...BARE,
        subjectName: 'Astrid',
        female: true,
        family: { wait: 'husbandAway', partner },
      });
    const named = family({ name: 'Olaf', jobLabel: 'Zwiadowca', female: false });
    expect(named.short).toBe('Mąż nie wraca');
    expect(
      named.full.startsWith('Astrid nie może mieć dziecka: jej mąż Olaf (Zwiadowca) przez swój zawód'),
    ).toBe(true);
    expect(family(null).full.startsWith('Astrid nie może mieć dziecka: jej mąż przez swój zawód')).toBe(true);
  });
});
