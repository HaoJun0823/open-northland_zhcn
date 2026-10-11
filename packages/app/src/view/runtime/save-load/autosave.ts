import { TICKS_PER_SECOND } from '@open-northland/sim';
import { diag } from '../../../diag/index.js';
import type { AutosaveMinutes } from '../../settings-store.js';
import { autosaveSlots } from './autosave-slots.js';
import type { SaveLoadSession } from './controller.js';

/** A local preference also captures relayed sessions through their normal save hooks. */
export function createAutosave(
  session: Pick<SaveLoadSession, 'listSaves' | 'saveGame' | 'worldToken'>,
  initialTick: number,
  initialMinutes: AutosaveMinutes,
  signal: AbortSignal,
) {
  const ids = autosaveSlots(session.worldToken);
  let minutes = initialMinutes;
  let revision = 0;
  let lastTick = initialTick;
  let due = initialTick + minutes * 60 * TICKS_PER_SECOND;
  let pending = false;

  const save = async (startedRevision: number): Promise<void> => {
    try {
      const slots = await session.listSaves();
      if (signal.aborted || startedRevision !== revision || minutes === 0) return;
      const missing = ids.find((id) => !slots.some((slot) => slot.id === id));
      const oldest = slots
        .filter((slot) => ids.some((id) => id === slot.id))
        .sort((a, b) => (a.savedAt ?? 0) - (b.savedAt ?? 0))[0];
      const name = missing ?? oldest?.id;
      if (name !== undefined) await session.saveGame(name);
    } catch (error) {
      diag.warn('save', 'Autosave failed', { error: String(error) });
    } finally {
      pending = false;
    }
  };

  return {
    update(tick: number, nextMinutes: AutosaveMinutes): void {
      if (signal.aborted) return;
      if (nextMinutes !== minutes || tick < lastTick) {
        revision++;
        minutes = nextMinutes;
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
