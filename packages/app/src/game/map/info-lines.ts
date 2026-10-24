import type { InfoLineView, MatchGoalProgress } from '@open-northland/sim';

/** The `%d` a map's info string prints its tally into; a second one prints the line's `extra`. */
const COUNT_PLACEHOLDER = '%d';

/**
 * One info line's text: the map's string with its first `%d` replaced by the live count and the
 * second by the line's `extra` (reading: the original prints through its `printf` with those two
 * arguments, a plain string getting zeros). A string the map's table lacks prints its id.
 */
export function formatInfoLine(text: string | undefined, line: InfoLineView): string {
  let out = text ?? `#${line.stringId}`;
  for (const value of [line.count, line.extra]) {
    const at = out.indexOf(COUNT_PLACEHOLDER);
    if (at < 0) break;
    out = `${out.slice(0, at)}${value}${out.slice(at + COUNT_PLACEHOLDER.length)}`;
  }
  return out;
}

/** A map may publish free text without a target; only explicit counts get a progress bar. */
export type MissionInfoRow =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'progress'; readonly label: string; readonly have: number; readonly need: number };

export function goalProgressRows(
  rows: readonly MatchGoalProgress[],
  naming: {
    readonly good: (typeId: number) => string | undefined;
    readonly inhabitants: string;
    readonly soldiers: string;
  },
): MissionInfoRow[] {
  return rows.map((row) => ({
    kind: 'progress',
    label:
      row.kind === 'goods'
        ? (naming.good(row.good) ?? `#${row.good}`)
        : row.soldiers
          ? naming.soldiers
          : naming.inhabitants,
    have: row.have,
    need: row.need,
  }));
}

/** Presentation convention: an authored trailing `%d/target` becomes a counter. Other templates
 * retain their complete formatted text; numbers in prose never imply a victory condition. */
export function infoLineRows(
  lines: readonly InfoLineView[],
  textOf: (stringId: number) => string | undefined,
): MissionInfoRow[] {
  return lines.map((line) => {
    const template = textOf(line.stringId);
    const ratio = template?.match(/^([^%]+?)\s*%d\s*\/\s*(\d+|%d)\s*$/u);
    if (ratio !== undefined && ratio !== null) {
      const label = ratio[1]
        ?.trim()
        .replace(/[:：]$/u, '')
        .trim();
      const need = ratio[2] === '%d' ? line.extra : Number(ratio[2]);
      if (label && Number.isSafeInteger(need) && need > 0 && line.count >= 0) {
        return { kind: 'progress', label, have: line.count, need };
      }
    }
    return { kind: 'text', text: formatInfoLine(template, line) };
  });
}
