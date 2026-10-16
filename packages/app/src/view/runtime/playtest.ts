import { adminCommand, type Command, parseCommandEnvelope, type SimEvent } from '@open-northland/sim';
import { hasDebugFlag } from '../../diag/debug-flags.js';
import type { LoadOutcome, SaveLoadSession, SaveOutcome } from './save-load/index.js';

const PREPARATION_KINDS = new Set([
  'debugTeleport',
  'debugKill',
  'debugSetHealth',
  'debugSetNeeds',
  'debugFillStockpile',
  'debugCompleteConstruction',
  'spawnSettler',
]);
const SPAWN_FIELDS = new Set([
  'kind',
  'jobType',
  'x',
  'y',
  'tribe',
  'owner',
  'hitpoints',
  'weaponTypeId',
  'armorClass',
  'equipment',
  'experience',
]);
const JOURNAL_CAPACITY = 512;

type JournalEvent = SimEvent | { readonly kind: 'preparationRejected'; readonly reason: string };
export interface PlaytestRow {
  readonly cursor: number;
  /** The drawn tick when the runtime delivered this event batch, not its originating sim tick. */
  readonly observedTick: number;
  readonly event: JournalEvent;
}
export interface PlaytestJournal {
  readonly rows: readonly PlaytestRow[];
  readonly nextCursor: number;
  readonly overflow: boolean;
}
export interface PlaytestHandle {
  prepare(command: unknown): {
    readonly status: 'submitted';
    readonly kind: Command['kind'];
    readonly tick: number;
  };
  events(afterCursor?: number): PlaytestJournal;
  checkpoint(name: string): Promise<SaveOutcome>;
  restore(name: string): Promise<LoadOutcome>;
}
interface PlaytestDeps {
  readonly params: URLSearchParams;
  readonly sharedClock: boolean;
  readonly readOnly: () => boolean;
  readonly tick: () => number;
  readonly submit: (command: Command) => void;
  readonly saveLoad: Pick<SaveLoadSession, 'saveGame' | 'loadSave'>;
}

/** Only the explicitly enabled local world owns a preparation channel. */
export function createPlaytest(deps: PlaytestDeps): {
  readonly handle: PlaytestHandle;
  readonly onEvents: (events: readonly SimEvent[]) => void;
} | null {
  if (!hasDebugFlag(deps.params, 'playtest') || deps.sharedClock || deps.readOnly()) return null;
  const rows: PlaytestRow[] = [];
  let cursor = 0;
  const append = (event: JournalEvent): void => {
    rows.push({ cursor: ++cursor, observedTick: deps.tick(), event: structuredClone(event) });
    if (rows.length > JOURNAL_CAPACITY) rows.shift();
  };
  const assertEditable = (): void => {
    if (deps.readOnly()) throw new Error('Playtest preparation requires an editable local session');
  };
  const slot = (name: string): string => {
    if (typeof name !== 'string' || name.trim() === '' || name.length > 80) {
      throw new Error('Checkpoint name must contain 1–80 characters');
    }
    return `playtest: ${name}`;
  };
  return {
    handle: {
      prepare(value) {
        try {
          assertEditable();
          const command = parseCommandEnvelope(adminCommand(value as Command)).command;
          if (!PREPARATION_KINDS.has(command.kind)) throw new Error('Unsupported playtest preparation kind');
          if (command.kind === 'spawnSettler' && Object.keys(command).some((key) => !SPAWN_FIELDS.has(key))) {
            throw new Error('Playtest settlers accept only ordinary debug spawn fields');
          }
          if ('target' in command && (typeof command.target !== 'number' || command.target < 0)) {
            throw new Error('Preparation target must be a nonnegative entity id');
          }
          if (command.kind === 'debugSetHealth' && (command.percent < 1 || command.percent > 100)) {
            throw new Error('Health percent must be in 1–100');
          }
          if (command.kind === 'debugSetNeeds') {
            for (const need of [command.hunger, command.fatigue, command.piety, command.enjoyment]) {
              if (need !== undefined && (need < 0 || need > 100)) throw new Error('Needs must be in 0–100');
            }
          }
          // Own the payload even when an inline driver keeps it until a later tick.
          deps.submit(structuredClone(command));
          return { status: 'submitted', kind: command.kind, tick: deps.tick() };
        } catch (error) {
          append({ kind: 'preparationRejected', reason: String(error).slice(0, 500) });
          throw error;
        }
      },
      events(afterCursor = 0) {
        if (!Number.isSafeInteger(afterCursor) || afterCursor < 0 || afterCursor > cursor) {
          throw new Error('Event cursor must belong to this running world');
        }
        return {
          rows: structuredClone(rows.filter((row) => row.cursor > afterCursor)),
          nextCursor: cursor,
          overflow: afterCursor < (rows[0]?.cursor ?? 1) - 1,
        };
      },
      checkpoint(name) {
        assertEditable();
        return deps.saveLoad.saveGame(slot(name));
      },
      restore(name) {
        assertEditable();
        return deps.saveLoad.loadSave(slot(name));
      },
    },
    onEvents(events) {
      for (const event of events) {
        if (
          event.kind.startsWith('mission') ||
          event.kind.endsWith('Refused') ||
          event.kind === 'playerWon' ||
          event.kind === 'playerDefeated'
        )
          append(event);
      }
    },
  };
}
