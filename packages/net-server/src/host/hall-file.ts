import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { type HallRecord, parseHallRecord } from '../relay/hall/record.js';
import { faultFields, type RelayLog } from '../relay/relay-log.js';

/** A change is written this long after it, so a busy chat costs one write per interval. */
export const HALL_SAVE_DELAY_MS = 10_000;

export interface HallFile {
  /** The record the file held at start, null for none or one that could not be read. */
  readonly initial: HallRecord | null;
  /** Something changed: write `read()` after `HALL_SAVE_DELAY_MS`. */
  changed(): void;
  /** Write at once, as the host stops. */
  flush(): void;
}

/** The hall kept in one JSON file, replaced whole through a temporary beside it. A file that does not
 *  parse is moved aside to `<path>.rejected` and the hall starts empty. */
export function hallFile(path: string, read: () => HallRecord, log: RelayLog): HallFile {
  const temporary = `${path}.tmp`;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;
  let again = false;

  const write = (): void => {
    timer = null;
    if (writing) {
      again = true;
      return;
    }
    writing = true;
    writeFile(temporary, JSON.stringify(read()))
      .then(() => rename(temporary, path))
      .catch((err: unknown) => log('hall save failed', { path, ...faultFields(err) }))
      .finally(() => {
        writing = false;
        if (again) {
          again = false;
          write();
        }
      });
  };

  return {
    initial: readInitial(path, log),
    changed(): void {
      timer ??= setTimeout(write, HALL_SAVE_DELAY_MS);
    },
    flush(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      try {
        writeFileSync(temporary, JSON.stringify(read()));
        renameSync(temporary, path);
      } catch (err) {
        log('hall save failed', { path, ...faultFields(err) });
      }
    },
  };
}

function readInitial(path: string, log: RelayLog): HallRecord | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      log('hall load failed', { path, ...faultFields(err) });
    return null;
  }
  try {
    const record = parseHallRecord(JSON.parse(text));
    log('hall loaded', { path, lines: record.chat.length, seen: record.seen.length });
    return record;
  } catch (err) {
    log('hall rejected', { path, ...faultFields(err) });
    try {
      renameSync(path, `${path}.rejected`);
    } catch (moveErr) {
      log('hall load failed', { path, ...faultFields(moveErr) });
    }
    return null;
  }
}
