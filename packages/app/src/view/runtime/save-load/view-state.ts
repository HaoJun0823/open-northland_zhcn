import { CONTROL_GROUP_ACTIONS, type ControlGroupAction } from '../../../hud/keybindings.js';
import type { ControlGroupMembers } from '../../unit-controls/control-groups.js';

/** What the app writes into a save header's `view`: the client's own state, never the sim's. */
export interface SavedView {
  /** The seat whose groups these are; null for a whole-map viewer. */
  readonly seat: number | null;
  readonly controlGroups: ControlGroupMembers;
}

/** Members a save keeps over all groups, well inside the header's 4096-value budget, so large or
 *  overlapping groups never cost the save itself. */
const MAX_SAVED_MEMBERS = 2048;

/** The view a save records: each group's members `isMember` still accepts, in group order, cut off
 *  at {@link MAX_SAVED_MEMBERS}. */
export function savedView(
  seat: number | null,
  members: ControlGroupMembers,
  isMember: (id: number) => boolean,
): SavedView {
  const controlGroups: Partial<Record<ControlGroupAction, readonly number[]>> = {};
  let kept = 0;
  for (const action of CONTROL_GROUP_ACTIONS) {
    const ids = (members[action] ?? []).filter(isMember).slice(0, MAX_SAVED_MEMBERS - kept);
    if (ids.length === 0) continue;
    controlGroups[action] = ids;
    kept += ids.length;
  }
  return { seat, controlGroups };
}

/** The groups a save restores into `seat`, or none when another seat saved it or it holds no view. */
export function restoredControlGroups(view: unknown, seat: number | null): ControlGroupMembers | undefined {
  const saved = savedViewOf(view);
  return saved !== null && saved.seat === seat ? saved.controlGroups : undefined;
}

/** A save's `view` header as the app wrote it, or null when absent or malformed: losing the groups
 *  never fails a load. */
export function savedViewOf(value: unknown): SavedView | null {
  if (!isRecord(value)) return null;
  const { seat, controlGroups } = value;
  if (seat !== null && !isEntityRef(seat)) return null;
  if (!isRecord(controlGroups)) return null;
  const groups: Partial<Record<ControlGroupAction, readonly number[]>> = {};
  for (const [key, ids] of Object.entries(controlGroups)) {
    const action = CONTROL_GROUP_ACTIONS.find((candidate) => candidate === key);
    if (action === undefined || !Array.isArray(ids) || !ids.every(isEntityRef)) return null;
    groups[action] = ids;
  }
  return { seat, controlGroups: groups };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntityRef(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
