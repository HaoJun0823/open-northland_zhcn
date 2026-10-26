import { randomReportId } from '../report-id.js';
import { deleteFreezeRecords, putFreezeRecord } from './freeze-records.js';
import { FREEZE_REPORT_MS, FreezeWatch, WATCHDOG_BEAT_MS } from './freeze-watch.js';
import type { Thaw, ToWatchdog } from './protocol.js';

// A dedicated worker's global scope; the DOM typings the app compiles against describe a window.
const scope = globalThis as unknown as {
  postMessage(message: Thaw): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<ToWatchdog>) => void): void;
};

let tabId: string | null = null;
/** The record of the freeze under way, written once it passed the threshold. */
let record: { readonly id: string; readonly written: Promise<void> } | null = null;

const watch = new FreezeWatch(
  {
    frozen: (silentMs, context) => {
      if (tabId === null || context === null) return;
      const id = randomReportId();
      const frozenAt = Date.now() - silentMs;
      // A failed write loses only the report of a page that never comes back.
      const written = putFreezeRecord({ id, tabId, frozenAt, silentMs, context }).catch(() => undefined);
      record = { id, written };
    },
    thawed: (freezeMs, context) => {
      scope.postMessage({ kind: 'thawed', freezeMs, frozenAt: Date.now() - freezeMs, context });
      const ended = record;
      record = null;
      if (ended !== null)
        void ended.written.then(() => deleteFreezeRecords([ended.id])).catch(() => undefined);
    },
  },
  FREEZE_REPORT_MS,
  WATCHDOG_BEAT_MS,
  performance.now(),
);

scope.addEventListener('message', ({ data }) => {
  if (data.kind === 'beat') watch.beat(performance.now(), data.visible, data.context);
  else if (tabId === null) {
    tabId = data.tabId;
    setInterval(() => watch.check(performance.now()), WATCHDOG_BEAT_MS);
  }
});
