import type { MissionInfoRow } from '../../../game/map/info-lines.js';
import { formatMessage, messages } from '../../../i18n/index.js';
import { escapeHtml } from '../parts/dom.js';

/** Shared by the slip and the book; reaching a counter's target does not complete a script goal. */
export function infoRowsMarkup(rows: readonly MissionInfoRow[]): string {
  if (rows.length === 0) return '';
  const items = rows
    .map((row) => {
      if (row.kind === 'text') return `<p class="on-goal-info__notice">${escapeHtml(row.text)}</p>`;
      const label = escapeHtml(row.label);
      const bounded = Math.max(0, Math.min(row.need, row.have));
      const track =
        row.need > 0
          ? `<div class="on-goal-info__track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${row.need}" aria-valuenow="${bounded}"><div style="width:${(bounded / row.need) * 100}%"></div></div>`
          : '';
      return `<div class="on-goal-info__row${row.have >= row.need ? ' on-goal-info__row--reached' : ''}"><div class="on-goal-info__line"><span>${label}</span><span class="on-goal-info__count">${row.have} <small>/ ${row.need}</small></span></div>${track}</div>`;
    })
    .join('');
  return `<div class="on-goal-info">${items}</div>`;
}

export function infoRowsSummary(rows: readonly MissionInfoRow[]): string {
  const counters = rows.filter((row) => row.kind === 'progress');
  const first = counters[0];
  if (first === undefined) return '';
  const text =
    counters.length === 1
      ? `${first.have}/${first.need}`
      : formatMessage(messages().hud.missionBook.progressCounters, { count: counters.length });
  const title = counters.map((row) => `${row.label} ${row.have}/${row.need}`).join(', ');
  return `<span class="on-slip__progress" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}
