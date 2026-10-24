import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { primaryCheckoutRoot } from './dir.mjs';

/** Read only the local data setting; never load unrelated credentials into this process. */
export function localDataArchive(root, env = process.env) {
  if (env.ON_DATA_ZIP !== undefined) return resolveSetting(env.ON_DATA_ZIP, root);
  const files = [resolve(root, '.env')];
  const primary = resolve(primaryCheckoutRoot(root), '.env');
  if (!files.includes(primary)) files.push(primary);
  for (const file of files) {
    if (!existsSync(file)) continue;
    const value = parseEnv(readFileSync(file, 'utf8')).ON_DATA_ZIP;
    if (value !== undefined) return resolveSetting(value, dirname(file));
  }
  return undefined;
}

function resolveSetting(value, root) {
  return value.trim() === '' ? undefined : resolve(root, value);
}
