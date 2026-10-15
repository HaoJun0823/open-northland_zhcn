import { TICKS_PER_SECOND } from '@open-northland/sim';
import { diag } from '../../../diag/index.js';
import type { MenuSettings } from '../../settings-store.js';
import { autosaveSlots } from './autosave-slots.js';
import type { SaveLoadSession } from './controller.js';

/** Read straight off the live settings each frame, so the frame allocates nothing for it. */
export type AutosavePreference = Pick<MenuSettings, 'autosaveMinutes' | 'autosaveCount'>;

/** A local preference also captures relayed sessions through their normal save hooks. */
export function createAutosave(
  session: Pick<SaveLoadSession, 'listSaves' | 'saveGame' | 'deleteSave' | 'worldToken'>,
  initialTick: number,
  initial: AutosavePreference,
  signal: AbortSignal,
) {
  const allIds = autosaveSlots(session.worldToken);
  let minutes = initial.autosaveMinutes;
  let count = initial.autosaveCount;
  let revision = 0;
  let lastTick = initialTick;
  let due = initialTick + minutes * 60 * TICKS_PER_SECOND;
  let pending = false;

  const save = async (startedRevision: number): Promise<void> => {
    try {
      const slots = await session.listSaves();
      if (signal.aborted || startedRevision !== revision || minutes === 0) return;
      // One count for both steps: a change while the write is in flight must not prune what it wrote.
      const kept = count;
      const ids = allIds.slice(0, kept);
      const missing = ids.find((id) => !slots.some((slot) => slot.id === id));
      const oldest = slots
        .filter((slot) => ids.some((id) => id === slot.id))
        .sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0))[0];
      const name = missing ?? oldest?.id;
      if (name === undefined) return;
      const outcome = await session.saveGame(name);
      // A lowered count drops the slots past it only once a fresh autosave stands in their place.
      if (outcome.kind !== 'saved') return;
      const beyond = allIds.slice(kept).filter((id) => slots.some((slot) => slot.id === id));
      for (const id of beyond) await session.deleteSave(id);
    } catch (error) {
      diag.warn('save', 'Autosave failed', { error: String(error) });
    } finally {
      pending = false;
    }
  };

  return {
    update(tick: number, next: AutosavePreference): void {
      if (signal.aborted) return;
      count = next.autosaveCount;
      if (next.autosaveMinutes !== minutes || tick < lastTick) {
        revision++;
        minutes = next.autosaveMinutes;
        due = tick + minutes * 60 * TICKS_PER_SECOND;
      }
      lastTick = tick;
      if (minutes === 0 || pending || tick < due) return;
      due = tick + minutes * 60 * TICKS_PER_SECOND;
      pending = true;
      void save(revision);
    },
  };
}
