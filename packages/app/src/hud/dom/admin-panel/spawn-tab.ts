import { formatMessage, messages } from '../../../i18n/index.js';
import { goodIconMarkup } from '../good-art.js';
import { GLYPH } from '../icons.js';
import { button, element, setAttribute, setClass, setHidden, write } from '../parts/dom.js';
import { nameContains } from '../parts/name-search.js';
import { createSegmented } from '../parts/segmented.js';
import { quietTextField } from '../parts/text-field.js';
import { createChoiceStrip } from './choice-strip.js';
import type {
  AdminKnob,
  AdminPanelHandlers,
  AdminPanelSpec,
  AdminSkills,
  AdminSpawnGroup,
  AdminTool,
} from './model.js';

/** Design px of a good's icon on its tile. */
const TILE_ICON_PX = 26;
/** The settings that stand above every group; the rest show with a group that uses them. */
const SHARED_KNOBS: ReadonlySet<AdminKnob> = new Set(['owner', 'hitpoints']);
const SKILL_KEYS: readonly AdminSkills[] = ['basic', 'all'];

export interface SpawnTab {
  readonly element: HTMLElement;
  /** Light the armed tool's tile; null lights none. */
  showArmed(key: string | null): void;
}

interface GroupView {
  readonly group: AdminSpawnGroup;
  readonly section: HTMLElement;
  readonly title: HTMLElement;
  readonly chip: HTMLButtonElement;
  readonly tiles: readonly {
    readonly key: string;
    readonly label: string;
    readonly tile: HTMLButtonElement;
  }[];
  /** Icons are painted on a group's first showing, not for every good at once. */
  painted: boolean;
}

/** The spawn tab: who and how strong a spawn is, then every spawnable thing by group or by search, with
 *  the open group's own settings (a soldier's weapon and armor) above its tiles. */
export function createSpawnTab(
  spec: AdminPanelSpec,
  handlers: Pick<
    AdminPanelHandlers,
    'onTool' | 'onOwner' | 'onHitpoints' | 'onWeapon' | 'onArmor' | 'onSkills'
  >,
): SpawnTab {
  const copy = messages().admin;
  const root = element('div', 'on-admin__pane');

  const knobs = element('div', 'on-admin__knobs');
  const knobRows = new Map<AdminKnob, HTMLElement>();
  const knob = (id: AdminKnob, label: string, tag: 'div' | 'label' = 'div'): HTMLElement => {
    const row = element(tag, 'on-admin__knob');
    const name = element('span', 'on-admin__label');
    write(name, label);
    row.append(name);
    knobRows.set(id, row);
    return row;
  };
  /** A knob whose options take a line of their own under its head. */
  const stackedKnob = (id: AdminKnob, head: HTMLElement, body: HTMLElement): HTMLElement => {
    const row = element('div', 'on-admin__knob on-admin__knob--stacked');
    row.append(head, body);
    knobRows.set(id, row);
    return row;
  };

  const ownerRow = knob('owner', copy.owner);
  const swatches = element('div', 'on-admin__swatches');
  swatches.setAttribute('role', 'radiogroup');
  swatches.setAttribute('aria-label', copy.owner);
  const ownerName = element('span', 'on-admin__owner-name');
  let owner = spec.owner;
  const swatchButtons = spec.owners.map((entry) => {
    const swatch = button('on-admin__swatch');
    swatch.setAttribute('role', 'radio');
    swatch.style.setProperty('--swatch', entry.css);
    swatch.setAttribute(
      'aria-label',
      formatMessage(copy.ownerName, { player: entry.player, name: entry.name }),
    );
    swatch.addEventListener('click', () => {
      owner = entry.player;
      paintOwner();
      handlers.onOwner(entry.player);
    });
    swatches.append(swatch);
    return { entry, swatch };
  });
  const paintOwner = (): void => {
    for (const { entry, swatch } of swatchButtons) {
      const chosen = entry.player === owner;
      setAttribute(swatch, 'aria-checked', String(chosen));
      if (chosen) write(ownerName, entry.name);
    }
  };
  ownerRow.append(swatches, ownerName);

  const hitpointsRow = knob('hitpoints', copy.hitpoints, 'label');
  const hitpointsField = element('span', 'on-res-field on-admin__number');
  const hitpoints = quietTextField(element('input', ''));
  hitpoints.type = 'number';
  hitpoints.min = '0';
  hitpoints.value = String(spec.hitpoints);
  // A spawn press `preventDefault()`s its mousedown, which keeps the field focused, so a `change`
  // commit would never come before that click.
  hitpoints.addEventListener('input', () => {
    const value = Number.parseInt(hitpoints.value, 10);
    handlers.onHitpoints(Number.isFinite(value) ? Math.max(0, value) : 0);
  });
  hitpointsField.append(hitpoints);
  hitpointsRow.append(hitpointsField);
  knobs.append(ownerRow, hitpointsRow);

  const options = element('div', 'on-admin__knobs on-admin__options');
  const weapon = createChoiceStrip(copy.weapon, spec.weapons, spec.weapon, spec.paintGood, handlers.onWeapon);
  const armor = createChoiceStrip(copy.armor, spec.armors, spec.armor, spec.paintGood, handlers.onArmor);
  const skillsRow = knob('skills', copy.skills);
  const skillOptions = {
    basic: { label: copy.skillModes.basic },
    all: { label: copy.skillModes.all },
  };
  const skills = createSegmented(SKILL_KEYS, copy.skills, (key) => {
    skills.update(skillOptions, key);
    handlers.onSkills(key);
  });
  skills.element.classList.add('on-admin__segmented');
  skills.update(skillOptions, spec.skills);
  skillsRow.append(skills.element);
  options.append(
    stackedKnob('weapon', weapon.head, weapon.strip),
    stackedKnob('armor', armor.head, armor.strip),
    skillsRow,
  );

  const search = element('label', 'on-res-field on-res-field--search on-admin__search', GLYPH.search);
  const query = quietTextField(element('input', ''));
  query.type = 'search';
  query.placeholder = copy.search;
  query.setAttribute('aria-label', copy.search);
  search.append(query);

  const chips = element('div', 'on-admin__chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', copy.groupsLabel);
  const note = element('p', 'on-admin__note');
  const list = element('div', 'on-admin__groups');
  const empty = element('p', 'on-admin__empty');

  let openGroup = spec.groups[0]?.id ?? '';
  let armedKey: string | null = null;
  const groups: GroupView[] = spec.groups.map((group) => {
    const chip = button('on-admin__chip');
    const chipName = element('span', '');
    write(chipName, group.title);
    const chipCount = element('small', '');
    write(chipCount, String(group.tools.length));
    chip.append(chipName, chipCount);
    chip.addEventListener('click', () => {
      openGroup = group.id;
      query.value = '';
      paint();
    });
    chips.append(chip);
    const section = element('section', 'on-admin__group');
    const title = element('h3', 'on-admin__group-title');
    write(title, group.title);
    const grid = element('div', 'on-admin__grid');
    const tiles = group.tools.map((tool) => {
      const tile = button('on-admin__tile', tool.goodId === undefined ? '' : goodIconMarkup(TILE_ICON_PX));
      const label = element('span', 'on-admin__tile-label');
      write(label, tool.label);
      tile.append(label);
      tile.setAttribute('aria-pressed', 'false');
      tile.addEventListener('click', () => handlers.onTool(tool.key));
      grid.append(tile);
      return { key: tool.key, label: tool.label, tile };
    });
    section.append(title, grid);
    list.append(section);
    return { group, section, title, chip, tiles, painted: false };
  });

  const paintIcons = (view: GroupView): void => {
    if (view.painted || spec.paintGood === undefined) return;
    view.painted = true;
    view.group.tools.forEach((tool, index) => {
      const frame = view.tiles[index]?.tile.querySelector('.on-good__frame');
      if (tool.goodId !== undefined && frame instanceof HTMLElement)
        spec.paintGood?.(frame, tool.goodId, TILE_ICON_PX);
    });
  };

  const armedTool = (): { readonly group: AdminSpawnGroup; readonly tool: AdminTool } | null => {
    for (const { group } of groups) {
      const tool = group.tools.find((t) => t.key === armedKey);
      if (tool !== undefined) return { group, tool };
    }
    return null;
  };
  const knobsOf = (group: AdminSpawnGroup): ReadonlySet<AdminKnob> =>
    new Set(group.tools.flatMap((tool) => tool.knobs));

  /** The settings a spawn takes fade where they do not apply: the armed tool's, else the open group's
   *  while browsing. A group's own settings show only with that group. */
  const paintKnobs = (searching: boolean): void => {
    const armed = armedTool();
    const open = searching ? null : (groups.find((view) => view.group.id === openGroup)?.group ?? null);
    const group = armed?.group ?? open;
    const used = group === null ? null : knobsOf(group);
    let optionsShown = false;
    for (const [id, row] of knobRows) {
      const applies = armed !== null ? armed.tool.knobs.includes(id) : used === null || used.has(id);
      const shared = SHARED_KNOBS.has(id);
      const shown = shared || used?.has(id) === true;
      setClass(row, 'on-admin__knob--idle', shown && !applies);
      if (shared) continue;
      setHidden(row, !shown);
      optionsShown ||= shown;
    }
    setHidden(options, !optionsShown);
  };

  const paint = (): void => {
    const text = query.value.trim();
    const searching = text !== '';
    setClass(root, 'on-admin__pane--searching', searching);
    let matches = 0;
    for (const view of groups) {
      const open = view.group.id === openGroup;
      setAttribute(view.chip, 'aria-pressed', String(open && !searching));
      let shown = 0;
      for (const { label, tile } of view.tiles) {
        const match = !searching || nameContains(label, text);
        setHidden(tile, !match);
        if (match) shown++;
      }
      const visible = searching ? shown > 0 : open;
      setHidden(view.section, !visible);
      setHidden(view.title, !searching);
      if (visible) paintIcons(view);
      if (searching) matches += shown;
    }
    const noteText = searching ? '' : (groups.find((v) => v.group.id === openGroup)?.group.note ?? '');
    setHidden(note, noteText === '');
    write(note, noteText);
    setHidden(empty, !searching || matches > 0);
    write(empty, formatMessage(copy.noMatches, { query: text }));
    paintKnobs(searching);
  };
  query.addEventListener('input', paint);

  root.append(knobs, search, chips, note, options, list, empty);
  paintOwner();
  paint();

  return {
    element: root,
    showArmed(key): void {
      armedKey = key;
      for (const view of groups)
        for (const { key: tileKey, tile } of view.tiles)
          setAttribute(tile, 'aria-pressed', String(tileKey === key));
      paint();
    },
  };
}
