import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dataPath, readCampaignMap, readDataPack } from '../data-pack.mjs';
import { syntheticPack } from './support/data-pack.mjs';

async function temp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'data-contract-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('rejects unsafe paths, extra files and changed source bytes', async (t) => {
  for (const path of ['/root', '../escape', 'C:/file', 'a\\b', 'a/./b', 'a//b', 'a\0b'])
    assert.throws(() => dataPath(path), /Invalid data path/);
  const root = await temp(t);
  await syntheticPack(root);
  await readDataPack(root);
  await writeFile(join(root, 'unexpected'), 'extra');
  await assert.rejects(readDataPack(root), /inventory/);
  await rm(join(root, 'unexpected'));
  await writeFile(join(root, 'base/rules/types/example.ini'), 'changed');
  await assert.rejects(readDataPack(root), /checksum/);
});

test('rejects the previous source layout version', async (t) => {
  const root = await temp(t);
  const manifest = await syntheticPack(root);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ ...manifest, version: 1 }));
  await assert.rejects(readDataPack(root), /version|Unsupported/);
});

test('rejects symlinks inside a source tree', async (t) => {
  const root = await temp(t);
  await syntheticPack(root);
  await symlink(join(root, 'manifest.json'), join(root, 'linked'));
  await assert.rejects(readDataPack(root), /non-regular/);
});

test('assembles two locales from one shared map and requires explicit script overrides', async (t) => {
  const root = await temp(t);
  const map = {
    id: 'first',
    shared: { 'map.dat': 'world/map.dat', 'mission.inc': 'mission/mission.inc' },
    locales: {
      pl: { files: { 'text/pol/strings.ini': 'locales/pl/strings.ini' }, replace: [] },
      en: { files: { 'mission.inc': 'locales/en/mission.inc' }, replace: ['mission.inc'] },
    },
  };
  const campaign = { version: 1, id: 'synthetic', maps: [map] };
  const files = {
    'campaigns/synthetic/campaign.json': JSON.stringify(campaign),
    'campaigns/synthetic/maps/first/world/map.dat': 'synthetic terrain',
    'campaigns/synthetic/maps/first/mission/mission.inc': 'shared mission',
    'campaigns/synthetic/maps/first/locales/pl/strings.ini': 'synthetic translation',
    'campaigns/synthetic/maps/first/locales/en/mission.inc': 'explicit variant',
  };
  await syntheticPack(root, files, ['synthetic']);
  const pl = await readCampaignMap(root, 'synthetic', 'first', 'pl');
  const en = await readCampaignMap(root, 'synthetic', 'first', 'en');
  assert.equal(pl.get('map.dat').toString(), 'synthetic terrain');
  assert.deepEqual(pl.get('map.dat'), en.get('map.dat'));
  assert.equal(pl.get('mission.inc').toString(), 'shared mission');
  assert.equal(en.get('mission.inc').toString(), 'explicit variant');
  await assert.rejects(readCampaignMap(root, 'synthetic', 'first', 'de'), /Unavailable/);
  map.locales.en.replace = [];
  await syntheticPack(root, { ...files, 'campaigns/synthetic/campaign.json': JSON.stringify(campaign) }, [
    'synthetic',
  ]);
  await assert.rejects(readDataPack(root), /explicitly list/);
});
