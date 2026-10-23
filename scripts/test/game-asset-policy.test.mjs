import assert from 'node:assert/strict';
import test from 'node:test';
import { isForbiddenGameFile, isReviewRequiredFile } from '../game-asset-policy.mjs';

test('original game files are forbidden whatever their case', () => {
  for (const name of ['data/sound/click.WAV', 'maps/a/map.dat', 'gfx/x.bmd', 'Game.exe']) {
    assert.equal(isForbiddenGameFile(name), true, name);
  }
  assert.equal(isForbiddenGameFile('docs/README.md'), false);
});

test('decoded sound clips and banks need a reviewed allowlist entry', () => {
  for (const name of [
    'fixtures/sounds/click.flac',
    'fixtures/sounds/click.OGG',
    'fixtures/sounds/click.opus',
    'fixtures/sounds/banks/ui.bin',
  ]) {
    assert.equal(isReviewRequiredFile(name), true, name);
  }
});

test('images need review, source text does not', () => {
  assert.equal(isReviewRequiredFile('docs/images/logo.webp'), true);
  assert.equal(isReviewRequiredFile('packages/app/src/main.ts'), false);
});
