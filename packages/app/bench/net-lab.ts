// First, so the sim it is evaluated before reads the switch.
import './sim-asserts.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LAB_USAGE, type LabConfig, parseLabArgs } from './net-lab/config.js';
import { runLab } from './net-lab/lab.js';
import { formatSummary } from './net-lab/report.js';

/**
 * The headless multiplayer load lab - `npm run bench:net-lab -- <flags>` (`--help` lists them). It plays
 * one relayed session on a real decoded map with headless human clients and computer seats, on the
 * in-memory relay and a virtual clock, and reports where each client's tick time and spikes went.
 * `scripts/bench-net-lab.mjs` bundles it from source and hard-fails without generated content.
 */
/** The exit status of a run refused for its arguments, apart from a run that measured a mismatch. */
const USAGE_EXIT_CODE = 2;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    console.log(LAB_USAGE);
    return;
  }
  let config: LabConfig;
  try {
    config = parseLabArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = USAGE_EXIT_CODE;
    return;
  }
  const report = await runLab(config, { progress: (line) => console.log(line) });
  console.log(`\n${formatSummary(report)}\n`);
  if (config.out !== null) {
    const path = resolve(config.out);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written to ${path}`);
  }
  if (!report.result.hashesAgree) process.exitCode = 1;
}

await main();
