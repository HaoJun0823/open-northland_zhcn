import type { MapScript, MapText } from '@open-northland/data';
import { extractMapScript, iniBytesToSections, type RuleSection } from '@open-northland/formats/ini';
import { errorMessage } from './errors.js';
import type { MapFolder } from './folder.js';
import { MAP_CIF_FILE, SCRIPT_FILES } from './layout.js';
import { type MapStringTables, mapTextOf, preferredStringTable } from './meta.js';

/**
 * Resolves one map folder's player roster, diplomacy and mission triggers: the already-decoded sibling
 * `map.cif` sections when they carry script data, else the folder's plaintext {@link SCRIPT_FILES}. An
 * unreadable `.inc` warns and is skipped so one bad file cannot drop the whole script. Returns
 * undefined when neither source yields anything.
 */
export function resolveMapScript(
  folder: MapFolder,
  cifSections: readonly RuleSection[] | undefined,
  tables: MapStringTables,
): MapScript | undefined {
  let script =
    cifSections !== undefined
      ? extractMapScript(cifSections, { file: `${folder.path}/${MAP_CIF_FILE}` })
      : undefined;
  if (script === undefined) {
    const sections: RuleSection[] = [];
    const read: string[] = [];
    for (const inc of SCRIPT_FILES) {
      const bytes = folder.read([inc]);
      if (bytes === undefined) continue;
      try {
        sections.push(...iniBytesToSections(bytes));
        read.push(inc);
      } catch (err) {
        folder.warn(`${inc} unreadable: ${errorMessage(err)}`);
      }
    }
    if (read.length > 0) {
      script = extractMapScript(sections, { file: `${folder.path}/${read.join('+')}` });
    }
  }
  if (script === undefined) return undefined;
  return attachMissionDescriptions(attachPlayerNames(script, tables), preferredStringTable(tables));
}

/**
 * Decorates the roster with authored display names: the `nametribe <player> <stringId>` lines kept in
 * `misc`, resolved through each of the map's string tables. A slot without a resolvable name stays
 * nameless.
 */
function attachPlayerNames(script: MapScript, tables: MapStringTables): MapScript {
  if (script.players.length === 0) return script;
  const nameBySlot = new Map<number, MapText>();
  for (const line of script.misc) {
    if (line.key !== 'nametribe') continue;
    const player = Number.parseInt(line.values[0] ?? '', 10);
    const stringId = Number.parseInt(line.values[1] ?? '', 10);
    const name = mapTextOf(tables, stringId);
    if (!Number.isNaN(player) && name !== undefined && !nameBySlot.has(player)) {
      nameBySlot.set(player, name);
    }
  }
  if (nameBySlot.size === 0) return script;
  return {
    ...script,
    players: script.players.map((p) => {
      const name = nameBySlot.get(p.player);
      return name === undefined ? p : { ...p, name };
    }),
  };
}

/** Resolves each trigger's `description <stringId>` to its text; `-1` and an unknown id stay textless. */
function attachMissionDescriptions(
  script: MapScript,
  strings: Record<number, string> | undefined,
): MapScript {
  if (strings === undefined || script.missions.length === 0) return script;
  let changed = false;
  const missions = script.missions.map((mission) => {
    const id = mission.descriptionStringId;
    const description = id === undefined || id < 0 ? undefined : strings[id];
    if (description === undefined) return mission;
    changed = true;
    return { ...mission, description };
  });
  return changed ? { ...script, missions } : script;
}
