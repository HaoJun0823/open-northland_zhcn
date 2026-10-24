import type { MissionStatus } from '@open-northland/sim';
import { formatMessage, messages } from '../../i18n/index.js';
import type { SessionHost } from '../../session/index.js';
import { el, PANEL_STYLE } from '../overlay.js';

const MAX_VISIBLE_MISSIONS = 100;

export function firedMissionRows(status: readonly MissionStatus[]): MissionStatus[] {
  return status
    .filter((row) => row.lastFiredTick !== undefined)
    .sort((a, b) => (b.lastFiredTick ?? 0) - (a.lastFiredTick ?? 0) || a.index - b.index)
    .slice(0, MAX_VISIBLE_MISSIONS);
}

/** Reads the status once per tick and rebuilds its rows when a mission fired since the last read. */
export function mountMissionTrace(host: Pick<SessionHost, 'missionStatus'>): {
  refresh(tick: number): void;
  dispose(): void;
} {
  const copy = messages().missionTrace;
  const panel = el('details', `${PANEL_STYLE};top:60px;left:12px;right:auto;width:300px`);
  panel.dataset.testid = 'mission-trace';
  const summary = el('summary', 'cursor:var(--cursor-pointer, pointer)', copy.title);
  const body = el('div', 'max-height:35vh;overflow:auto;margin-top:8px');
  panel.append(summary, body);
  document.body.append(panel);
  let readTick = -1;
  let fired = -1;
  return {
    refresh(tick) {
      if (tick === readTick) return;
      readTick = tick;
      const status = host.missionStatus();
      const total = status.reduce((sum, row) => sum + row.fireCount, 0);
      if (total === fired) return;
      fired = total;
      const rows = firedMissionRows(status);
      summary.textContent = formatMessage(copy.atTick, { tick });
      body.replaceChildren(el('p', 'margin:0 0 8px;opacity:.8', copy.note));
      if (rows.length === 0) body.append(el('p', '', copy.empty));
      for (const row of rows) {
        body.append(
          el(
            'div',
            'padding:3px 0',
            formatMessage(copy.row, {
              index: row.index,
              first: row.firstFiredTick ?? '',
              last: row.lastFiredTick ?? '',
              count: row.fireCount,
            }),
          ),
        );
      }
    },
    dispose: () => panel.remove(),
  };
}
