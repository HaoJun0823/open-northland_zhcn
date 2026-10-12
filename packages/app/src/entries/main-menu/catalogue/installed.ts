import { IR_VERSION } from '@open-northland/data/ir-version';
import type { InstalledMapRecord } from '../../../content/map-source/installed.js';
import { MAX_INSTALLED_MAP_BYTES } from '../../../content/map-source/installed.js';
import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { desktopMaps } from '../../../view/desktop-bridge.js';
import { node } from '../dom.js';
import { hasClaimableSeat } from '../lobby/roster-state.js';
import { listedIn, mapItem } from '../map-select-model.js';
import {
  badge,
  type CatalogueContext,
  downloadButton,
  pickButton,
  removeButton,
  thumbImage,
} from './card.js';
import { type InstalledGroup, mainCatalogMap } from './model.js';
import { formatBytes } from './query.js';

function installedDate(at: number): string {
  return new Intl.DateTimeFormat(bcp47Tag(), { dateStyle: 'medium' }).format(new Date(at));
}

interface InstalledActions {
  pick(record: InstalledMapRecord): void;
  rebuild(entryId: string): void;
}
function groupRow(group: InstalledGroup, ctx: CatalogueContext, local: InstalledActions): HTMLElement {
  const text = messages().mapCatalogue;
  const { row } = group;
  const element = node('div', 'catalogue-installed__row');
  element.dataset.entryId = group.entryId;
  const thumb = node('div', 'catalogue-installed__thumb');
  const img = row === null ? null : thumbImage(ctx.thumbnail(row.entry));
  if (img !== null) thumb.append(img);
  const main = mainCatalogMap(group.records);
  const title =
    row?.entry.title ?? (main === null ? (group.source?.name ?? group.entryId) : mapItem(main.index).title);
  const name = node('div', 'catalogue-installed__title', title);
  const parts = [
    formatMessage(
      pluralForm(group.source?.maps.length ?? group.records.length, text.installedView.maps, bcp47Tag()),
      {
        count: group.source?.maps.length ?? group.records.length,
      },
    ),
    formatBytes(group.bytes, bcp47Tag()),
    ...(group.records.length > 0
      ? [formatMessage(text.installedView.installedOn, { date: installedDate(group.installedAt) })]
      : []),
    ...(group.source !== undefined
      ? [text.localImport.local]
      : row === null
        ? [text.installedView.notListed]
        : []),
  ];
  const meta = node('div', 'catalogue-installed__meta', parts.join(' · '));
  const info = node('div', 'catalogue-installed__info');
  const state = row === null ? null : badge(row);
  info.append(name, meta);
  if (state !== null) name.append(state);
  const actions = node('div', 'catalogue-installed__actions');
  if (ctx.canStore) actions.append(removeButton(group.entryId, ctx));
  if (row !== null && (row.status === 'updatable' || row.status === 'redownload') && ctx.canStore)
    actions.append(downloadButton(row, ctx, 'main-menu__ghost is-accent'));
  if (row !== null && row.playableMapId !== null) actions.append(pickButton(row, ctx, 'main-menu__primary'));
  if (row === null) {
    const playable = group.records.filter((record) => record.irVersion === IR_VERSION);
    let selected =
      main === null ? playable[0] : (playable.find((record) => record.mapId === main.mapId) ?? playable[0]);
    const pick = node('button', 'main-menu__primary', ctx.purpose === 'choose' ? text.choose : text.play);
    pick.type = 'button';
    const paintPick = (): void => {
      pick.disabled =
        selected === undefined ||
        (ctx.purpose === 'choose' &&
          (!listedIn(mapItem(selected.index), 'multiplayer') ||
            !hasClaimableSeat(selected.index.players ?? [])));
      pick.title = pick.disabled ? text.notMultiplayer : '';
    };
    if (playable.length > 1) {
      const select = node('select', 'catalogue-installed__map-choice');
      select.setAttribute('aria-label', title);
      for (const record of playable) {
        const option = node('option', '', mapItem(record.index).title);
        option.value = record.mapId;
        option.selected = record === selected;
        select.append(option);
      }
      select.addEventListener('change', () => {
        selected = playable.find((record) => record.mapId === select.value);
        paintPick();
      });
      info.append(select);
    }
    pick.addEventListener('click', () => {
      if (selected !== undefined) local.pick(selected);
    });
    paintPick();
    if (playable.length > 0) actions.append(pick);
    if (group.source !== undefined && playable.length !== group.source.maps.length) {
      const rebuild = node('button', 'main-menu__ghost', text.localImport.rebuild);
      rebuild.type = 'button';
      rebuild.addEventListener('click', () => local.rebuild(group.entryId));
      actions.append(rebuild);
    }
  }
  const failure = ctx.failure(group.entryId);
  if (failure !== undefined) info.append(node('p', 'catalogue-import__status is-error', failure));
  element.append(thumb, info, actions);
  if (row !== null) {
    element.classList.add('is-listed');
    element.addEventListener('click', () => ctx.open(group.entryId));
  }
  return element;
}

/** What is on disk: space used, updates waiting, and each installed entry with its actions. */
export function installedPane(ctx: CatalogueContext, local: InstalledActions) {
  const catalogue = messages().mapCatalogue;
  const text = catalogue.installedView;
  const root = node('section', 'catalogue-installed');
  const head = node('div', 'catalogue-installed__head');
  const heading = node('h2');
  const summary = node('p', 'catalogue-installed__summary');
  head.append(heading, summary);
  const scroll = node('div', 'main-menu__map-scroll catalogue-installed__scroll');
  const list = node('div', 'catalogue-installed__list');
  scroll.append(list);
  root.append(head, scroll);
  return {
    root,
    paint(groups: readonly InstalledGroup[], selectedId: string | null): void {
      heading.textContent = formatMessage(catalogue.tabs.installed, { count: groups.length });
      const bytes = groups.reduce((sum, group) => sum + group.bytes, 0);
      const updates = groups.filter(
        (group) => group.row?.status === 'updatable' || group.row?.status === 'redownload',
      ).length;
      summary.textContent = [
        formatMessage(text.spaceUsed, { size: formatBytes(bytes, bcp47Tag()) }),
        ...(desktopMaps() === null
          ? [
              formatMessage(catalogue.localImport.webBudget, {
                size: formatBytes(MAX_INSTALLED_MAP_BYTES, bcp47Tag()),
              }),
            ]
          : []),
        ...(updates > 0
          ? [formatMessage(pluralForm(updates, text.updates, bcp47Tag()), { count: updates })]
          : []),
      ].join(' · ');
      if (groups.length === 0) {
        list.replaceChildren(node('p', 'catalogue__empty', text.none));
        return;
      }
      list.replaceChildren(
        ...groups.map((group) => {
          const element = groupRow(group, ctx, local);
          element.classList.toggle('is-selected', group.entryId === selectedId);
          return element;
        }),
      );
    },
  };
}
