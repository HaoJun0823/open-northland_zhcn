import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { SCENES } from '../../src/scenes/index.js';
import { SCENE_TEST_SUFFIX } from './scene-case.js';

/** Each scene owns a test file so Vitest can spread the runs over workers, which means a newly
 *  registered scene silently loses its headless run until someone adds one. */
const SCENES_DIR = dirname(fileURLToPath(import.meta.url));

it('registers one test file per acceptance scene', () => {
  // Scene runs live one folder down, by mechanic; files beside this one test the scene machinery.
  const covered = readdirSync(SCENES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => readdirSync(join(SCENES_DIR, entry.name)))
    .filter((name) => name.endsWith(SCENE_TEST_SUFFIX))
    .map((name) => basename(name, SCENE_TEST_SUFFIX))
    .sort();
  expect(covered).toEqual(SCENES.map((scene) => scene.id).sort());
});
