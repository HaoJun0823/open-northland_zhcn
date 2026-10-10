import { execFile } from 'node:child_process';
import type { RegistryHive } from './candidates.js';

/** A hung `reg` must not hold the first launch. */
const REG_QUERY_TIMEOUT_MS = 5_000;
const STRING_TYPE = 'REG_SZ';

/** The data of `value` in `reg query /v` output: an indented `<name>    REG_SZ    <data>` line. */
export function parseRegQuery(output: string, value: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s{2,}|\t/);
    const [name, type, ...data] = fields;
    if (name?.toLowerCase() === value.toLowerCase() && type === STRING_TYPE) {
      const text = data.join('  ').trim();
      return text === '' ? undefined : text;
    }
  }
  return undefined;
}

/** Reads a string value through `reg.exe`, without a shell; `undefined` for any failure. */
export function queryWindowsRegistry(
  hive: RegistryHive,
  key: string,
  value: string,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', `${hive}\\${key}`, '/v', value],
      { windowsHide: true, timeout: REG_QUERY_TIMEOUT_MS },
      (error, stdout) => resolve(error === null ? parseRegQuery(stdout, value) : undefined),
    );
  });
}
