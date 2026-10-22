// Stands in for the browser lab's process: one recorded child, a slow browser close and the lab's
// signal handling. Prints `child <pid>` once the child runs; the argument is the log directory.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProcessSet, stopOnSignals } from '../../net-browser-lab/processes.mjs';

/** Long enough that an exit which did not wait for the close would skip the stops after it. */
const BROWSER_CLOSE_MS = 300;
const KEEP_ALIVE_MS = 1000;

const logDir = process.argv[2];
const processes = createProcessSet(logDir, () => undefined);
stopOnSignals(processes, {
  beforeStop: async () => {
    await new Promise((done) => setTimeout(done, BROWSER_CLOSE_MS));
    writeFileSync(join(logDir, 'browser-closed'), '');
  },
  log: () => undefined,
});
const idle = ['-e', "console.log('ready'); setInterval(() => {}, 1000);"];
const record = await processes.start('idle', process.execPath, idle, { ready: /ready/ });
console.log(`child ${record.pid}`);
setInterval(() => undefined, KEEP_ALIVE_MS);
