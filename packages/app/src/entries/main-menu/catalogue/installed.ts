import { bcp47Tag, formatMessage, messages, pluralForm } from '../../../i18n/index.js';
import { node } from '../dom.js';
import { mapItem } from '../map-select-model.js';
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

function groupRow(group: InstalledGroup, ctx: CatalogueContext): HTMLElement {
  const text = messages().mapCatalogue;
  const { row } = group;
  const element = node('div', 'catalogue-installed__row');
  element.dataset.entryId = group.entryId;
  const thumb = node('div', 'catalogue-installed__thumb');
  const img = row === null ? null : thumbImage(ctx.thumbnail(row.entry));
  if (img !== null) thumb.append(img);
  const main = mainCatalogMap(group.records);
  const title = row?.entry.title ?? (main === null ? group.entryId : mapItem(main.index).title);
  const name = node('div', 'catalogue-installed__title', title);
  const parts = [
    formatMessage(pluralForm(group.records.length, text.installedView.maps, bcp47Tag()), {
      count: group.records.length,
    }),
    formatBytes(group.bytes, bcp47Tag()),
    formatMessage(text.installedView.installedOn, { date: installedDate(group.installedAt) }),
    ...(row === null ? [text.installedView.notListed] : []),
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
  element.append(thumb, info, actions);
  if (row !== null) {
    element.classList.add('is-listed');
    element.addEventListener('click', () => ctx.open(group.entryId));
  }
  return element;
}

/** What is on disk: space used, updates waiting, and each installed entry with its actions. */
export function installedPane(ctx: CatalogueContext) {
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
          const element = groupRow(group, ctx);
          element.classList.toggle('is-selected', group.entryId === selectedId);
          return element;
        }),
      );
    },
  };
}
