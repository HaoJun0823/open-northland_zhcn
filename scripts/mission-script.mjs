#!/usr/bin/env node
// A readable dump of one generated map's mission script: every mission with its decoded goals and
// results, the opcodes this build cannot run marked, goal texts and briefing pages in one language.
// It reads the generated sidecars only, so it shows what the game runs, corrections included.
//
// Usage: node scripts/mission-script.mjs <map id> [--lang pol|eng|ger|rus] [--pages] [--mission <n>]
//   --pages      also print every briefing page's text (long)
//   --mission n  print one mission, with the pages its results open
// Needs the workspace built (npx tsc --build) and generated content (ON_CONTENT_DIR or content/).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentDir } from './content-dir.mjs';

let decodeMissionGoal;
let decodeMissionResult;
let systems;
try {
  ({ decodeMissionGoal, decodeMissionResult } = await import('../packages/data/dist/index.js'));
  ({ systems } = await import('../packages/sim/dist/index.js'));
} catch (err) {
  console.error(`mission-script needs the workspace built (npx tsc --build): ${String(err)}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const VALUE_FLAGS = new Set(['--lang', '--mission']);
const mapId = args.find((arg, at) => !arg.startsWith('--') && !VALUE_FLAGS.has(args[at - 1] ?? ''));
const lang = flag('--lang') ?? 'pol';
const pages = args.includes('--pages');
const onlyMission = flag('--mission') === undefined ? undefined : Number.parseInt(flag('--mission'), 10);
if (mapId === undefined) {
  console.error(
    'usage: node scripts/mission-script.mjs <map id> [--lang pol|eng|ger|rus] [--pages] [--mission <n>]',
  );
  process.exit(2);
}

const mapsDir = resolve(contentDir(), 'maps');
const sidecar = (suffix) => {
  const path = resolve(mapsDir, `${mapId}${suffix}`);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
};
const script = sidecar('.script.json');
if (script === undefined) {
  console.error(`no ${mapId}.script.json under ${mapsDir} (ON_CONTENT_DIR or content/)`);
  process.exit(1);
}
const meta = sidecar('.meta.json') ?? {};
const strings = sidecar('.strings.json')?.[lang] ?? {};
const briefing = sidecar('.briefing.json')?.texts?.[lang] ?? {};

const supported = { goal: new Set(systems.SUPPORTED_GOALS), result: new Set(systems.SUPPORTED_RESULTS) };
const SUCCESSFUL_IF = { 0: 'all', 1: 'any', 2: 'half', 3: 'none' };
const MAP_TYPE_NAMES = {
  1: 'single-player campaign',
  2: 'single-player free',
  3: 'single-player demo',
  4: 'multiplayer free',
  5: 'user single-player',
  6: 'user multiplayer',
};

const text = (id) => (id === undefined || id < 0 ? undefined : strings[String(id)]);
const quoted = (value) => (value === undefined ? '' : ` "${value}"`);

function formatArg(key, value) {
  if (value === null || value === undefined) return `${key}=?`;
  if (typeof value === 'object') {
    if ('hx' in value) return `${key}=(${value.hx},${value.hy})`;
    if (value.ref === 'name') return `${key}=${value.name}`;
    if (value.ref === 'id') return `${key}=#${value.id}`;
    return `${key}=${JSON.stringify(value)}`;
  }
  return `${key}=${String(value)}`;
}

function formatLine(phase, line, decode) {
  let unknown;
  const op = decode(line, (warning) => {
    if (warning.reason === 'unknownOpcode') unknown = warning.opcode;
  });
  const { opcode, ...rest } = op;
  const parts = Object.entries(rest).map(([key, value]) => formatArg(key, value));
  let mark = '';
  if (unknown !== undefined) mark = ` [UNKNOWN opcode ${JSON.stringify(unknown)}]`;
  else if (!supported[phase].has(opcode)) mark = ' [UNSUPPORTED in this build]';
  let note = '';
  if (opcode === 'PlayCutscene') note = quoted(pageTitle(op.cutscene));
  if (opcode === 'SetHumanName') note = quoted(text(op.stringId));
  return `${opcode} ${parts.join(' ')}${note}${mark}`;
}

function pageTitle(page) {
  const blocks = briefing[String(page)];
  if (blocks === undefined) return `page ${page}: MISSING in ${lang}`;
  const title = blocks.find((block) => block.kind === 'text' && block.style === 'title');
  return title?.text ?? blocks.find((block) => block.kind === 'text')?.text?.slice(0, 60) ?? `page ${page}`;
}

function pageText(page) {
  const blocks = briefing[String(page)];
  if (blocks === undefined) return `    (page ${page} missing in ${lang})`;
  return blocks
    .map((block) => {
      if (block.kind === 'text')
        return `    ${block.style === 'title' ? '## ' : ''}${block.text.replaceAll('\n', '\n    ')}`;
      if (block.kind === 'callback') return `    [callback ${block.args.join(' ')}]`;
      if (block.kind === 'blank') return '';
      return `    [${block.kind}]`;
    })
    .join('\n');
}

const name = meta.name?.[lang] ?? meta.name?.eng ?? mapId;
console.log(`# ${mapId}: ${name}`);
if (meta.description?.[lang]) console.log(`${meta.description[lang]}`);
const types = (meta.mapTypes ?? []).map((type) => MAP_TYPE_NAMES[type] ?? `type ${type}`).join(', ');
console.log(
  `types: ${types || 'none'}${meta.campaign ? `; campaign ${meta.campaign.campaignId} mission ${meta.campaign.missionId}` : ''}`,
);
console.log(`source: ${script.source?.file ?? '?'}`);

console.log('\n## Seats');
for (const seat of script.players ?? []) {
  const flags = [
    seat.claimable ? 'claimable' : '',
    seat.hidden ? 'hidden' : '',
    seat.aiAllowed ? 'ai-allowed' : '',
  ]
    .filter(Boolean)
    .join(' ');
  console.log(`  player ${seat.player}: ${seat.type} tribe ${seat.tribeId} ${flags}`.trimEnd());
}
if ((script.diplomacy ?? []).length > 0) {
  const rows = script.diplomacy.map((row) => `${row.from}->${row.to} ${row.state}`);
  console.log(`  diplomacy: ${rows.join(', ')}`);
}
if ((script.humanNames ?? []).length > 0) {
  console.log('\n## Named humans');
  for (const row of script.humanNames)
    console.log(`  human #${row.humanId}: ${text(row.stringId) ?? `string ${row.stringId}`}`);
}
if ((script.tradeAgreements ?? []).length > 0)
  console.log(`\n## Trade agreements: ${script.tradeAgreements.length}`);
if ((script.specialItems ?? []).length > 0) console.log(`\n## Special items: ${script.specialItems.length}`);

console.log('\n## Missions');
const openedPages = new Set();
script.missions.forEach((mission, index) => {
  if (onlyMission !== undefined && index !== onlyMission) return;
  const state = [mission.active ? 'ACTIVE at start' : '', mission.visible ? 'visible' : '']
    .filter(Boolean)
    .join(', ');
  const rule =
    mission.successfullIf === undefined
      ? ''
      : ` if ${SUCCESSFUL_IF[mission.successfullIf] ?? mission.successfullIf}`;
  console.log(`\n### ${index} ${mission.debugName ?? ''}  ${state}${rule}`.trimEnd());
  const description = text(mission.descriptionStringId);
  if (description !== undefined) console.log(`  goal text: "${description}"`);
  for (const line of mission.goals ?? [])
    console.log(`  goal   ${formatLine('goal', line, decodeMissionGoal)}`);
  for (const line of mission.results ?? []) {
    console.log(`  result ${formatLine('result', line, decodeMissionResult)}`);
    const op = decodeMissionResult(line);
    if (op.opcode === 'PlayCutscene') openedPages.add(op.cutscene);
  }
  for (const line of mission.other ?? []) console.log(`  other  ${line.key} ${line.values.join(' ')}`);
  if (onlyMission !== undefined) {
    for (const page of openedPages) {
      console.log(`\n  page ${page}:`);
      console.log(pageText(page));
    }
  }
});

const pageIds = Object.keys(briefing)
  .map(Number)
  .sort((a, b) => a - b);
const unopened = pageIds.filter((page) => !openedPages.has(page));
console.log(
  `\n## Briefing pages (${lang}): ${pageIds.length}${unopened.length > 0 && onlyMission === undefined ? `; never opened by a result: ${unopened.join(', ')}` : ''}`,
);
if (pages && onlyMission === undefined) {
  for (const page of pageIds) {
    console.log(`\n### page ${page}`);
    console.log(pageText(page));
  }
}
