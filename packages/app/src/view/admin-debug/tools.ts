import type { Entity } from '@open-northland/sim';
import type { AdminAction, AdminArmed, AdminKnob, AdminSpawnGroup } from '../../hud/dom/admin-panel/model.js';
import { formatMessage, type Messages } from '../../i18n/index.js';
import { DEBUG_ACTIONS, type DebugAction } from './actions-catalog.js';
import type { AdminLabels } from './labels.js';
import {
  type AnimalEntry,
  CIVILIAN_PRESETS,
  CREATURE_PRESETS,
  type CreaturePreset,
  type GoodEntry,
  RESOURCE_ENTRIES,
  type UnitPreset,
  type VehicleEntry,
  WARRIOR_PRESETS,
} from './spawn-catalog.js';

/** What the next map click will do. */
export type Armed =
  | { readonly kind: 'unit'; readonly preset: UnitPreset }
  | { readonly kind: 'creature'; readonly preset: CreaturePreset }
  | { readonly kind: 'vehicle'; readonly entry: VehicleEntry }
  | { readonly kind: 'animal'; readonly entry: AnimalEntry }
  | { readonly kind: 'resource'; readonly good: number }
  | { readonly kind: 'good'; readonly good: number }
  | { readonly kind: 'action'; readonly action: DebugAction }
  /** Two clicks: the settler to move (`target` null until picked), then its destination. */
  | { readonly kind: 'teleport'; readonly target: Entity | null };

/** A tool key's meaning: an arm for map clicks, or the standing-wall line the HUD's wall tool draws. */
export type AdminToolChoice = Armed | { readonly kind: 'standingWall' };

const STANDING_WALL_KEY = 'standingWall';
const TELEPORT_KEY = 'teleport';

const UNIT_KNOBS: readonly AdminKnob[] = ['owner', 'hitpoints', 'armor'];
/** Monsters fight with natural weapons, so they wear no armor. */
const CREATURE_KNOBS: readonly AdminKnob[] = ['owner', 'hitpoints'];
const OWNED_KNOBS: readonly AdminKnob[] = ['owner'];
/** Herds, deposits and ground piles belong to nobody. */
const UNOWNED_KNOBS: readonly AdminKnob[] = [];

/** The key a tile carries for an arm; the teleport keeps one key through both of its clicks. */
export function armedKey(armed: Armed): string {
  switch (armed.kind) {
    case 'unit':
    case 'creature':
      return `${armed.kind}:${armed.preset.id}`;
    case 'vehicle':
      return `vehicle:${armed.entry.vehicleType}`;
    case 'animal':
      return `animal:${armed.entry.tribe}`;
    case 'resource':
    case 'good':
      return `${armed.kind}:${armed.good}`;
    case 'action':
      return `action:${armed.action.id}`;
    case 'teleport':
      return TELEPORT_KEY;
  }
}

export interface AdminToolSources {
  readonly goods: readonly GoodEntry[];
  readonly animals: readonly AnimalEntry[];
  readonly vehicles: readonly VehicleEntry[];
  /** The HUD can draw a standing wall line; false leaves the structures group out. */
  readonly standingWall: boolean;
}

/** Every tool the panel offers, grouped as it shows them, and the footer's words for an arm. */
export interface AdminToolCatalogue {
  readonly groups: readonly AdminSpawnGroup[];
  readonly actions: readonly AdminAction[];
  choiceOf(key: string): AdminToolChoice | undefined;
  /** `player` is the owner a spawn is dropped for. */
  describe(armed: Armed, player: number): AdminArmed;
}

export function createAdminToolCatalogue(
  messages: Messages,
  labels: AdminLabels,
  sources: AdminToolSources,
): AdminToolCatalogue {
  const copy = messages.admin;
  const choices = new Map<string, AdminToolChoice>();
  const toolLabels = new Map<string, string>();
  const tool = (choice: Armed, label: string, goodId?: string) => {
    const key = armedKey(choice);
    choices.set(key, choice);
    toolLabels.set(key, label);
    return goodId === undefined ? { key, label } : { key, label, goodId };
  };
  const group = (
    id: keyof Messages['admin']['groups'],
    knobs: readonly AdminKnob[],
    tools: AdminSpawnGroup['tools'],
    note?: string,
  ): AdminSpawnGroup => ({
    id,
    title: copy.groups[id],
    knobs,
    tools,
    ...(note === undefined ? {} : { note }),
  });

  const groups: AdminSpawnGroup[] = [
    group(
      'warriors',
      UNIT_KNOBS,
      WARRIOR_PRESETS.map((preset) => tool({ kind: 'unit', preset }, labels.unit(preset))),
    ),
    group(
      'civilians',
      UNIT_KNOBS,
      CIVILIAN_PRESETS.map((preset) => tool({ kind: 'unit', preset }, labels.unit(preset))),
    ),
    group(
      'creatures',
      CREATURE_KNOBS,
      CREATURE_PRESETS.map((preset) => tool({ kind: 'creature', preset }, labels.creature(preset))),
      copy.notes.creatures,
    ),
    group(
      'animals',
      UNOWNED_KNOBS,
      sources.animals.map((entry) => tool({ kind: 'animal', entry }, labels.animal(entry))),
      copy.notes.animals,
    ),
    group(
      'vehicles',
      OWNED_KNOBS,
      sources.vehicles.map((entry) => tool({ kind: 'vehicle', entry }, entry.label)),
    ),
    group(
      'resources',
      UNOWNED_KNOBS,
      RESOURCE_ENTRIES.map((entry) =>
        tool({ kind: 'resource', good: entry.good }, labels.good(entry), entry.id),
      ),
    ),
    group(
      'goods',
      UNOWNED_KNOBS,
      sources.goods.map((entry) => tool({ kind: 'good', good: entry.good }, labels.good(entry), entry.id)),
      copy.notes.goods,
    ),
  ];
  if (sources.standingWall) {
    choices.set(STANDING_WALL_KEY, { kind: 'standingWall' });
    groups.push(
      group(
        'structures',
        OWNED_KNOBS,
        [{ key: STANDING_WALL_KEY, label: copy.standingPalisade }],
        copy.notes.structures,
      ),
    );
  }

  const actions: AdminAction[] = [
    ...DEBUG_ACTIONS.map((action) => ({
      ...tool({ kind: 'action', action }, labels.action(action)),
      target: copy.actionHints[action.id],
      ...(action.targetKind === 'health' ? { percent: true } : {}),
    })),
    { ...tool({ kind: 'teleport', target: null }, copy.actions.teleport), target: copy.actionHints.teleport },
  ];

  return {
    // A group with nothing to offer (no vehicles in this content) is left out.
    groups: groups.filter((entry) => entry.tools.length > 0),
    actions,
    choiceOf: (key) => choices.get(key),
    describe(armed, player): AdminArmed {
      const key = armedKey(armed);
      const label = toolLabels.get(key) ?? key;
      switch (armed.kind) {
        case 'unit':
        case 'creature':
        case 'vehicle':
          return {
            key,
            name: formatMessage(copy.armedFor, { label, name: labels.player(player) }),
            hint: copy.hintSpawn,
          };
        case 'animal':
        case 'resource':
        case 'good':
          return { key, name: label, hint: copy.hintSpawn };
        case 'action':
          return { key, name: label, hint: copy.actionHints[armed.action.id] };
        case 'teleport':
          return {
            key,
            name: label,
            hint: armed.target === null ? copy.actionHints.teleport : copy.hintTeleportDestination,
          };
      }
    },
  };
}
