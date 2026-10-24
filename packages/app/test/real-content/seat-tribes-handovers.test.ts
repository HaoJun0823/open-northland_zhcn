import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decodeMissionResult,
  isCivilizationTribe,
  MapScript,
  type MapScriptLine,
  mapLobbySlots,
  TerrainMapFile,
} from '@open-northland/data';
import { components, type Entity, type SimEvent, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { buildMapWorldFromInputs } from '../../src/entries/map/world-inputs.js';
import { mapSession } from '../../src/game/match/session-url.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/**
 * Every map whose script hands things between seats, played with the person's seat on another
 * civilization: once its spawn, id-stamping and handover lines have all run, the world build has
 * already moved everything that reached the seat, so the handover safety net never fires and no
 * settler of the seat's authored people (heroes aside) is left in it. Point `ON_CONTENT_DIR` at a
 * content set with the campaigns to cover them.
 */

const VIKING = 1;
const BYZANTINE = 3;
const SEED = 7;
/** The script loads on the first tick and runs its forced mission in that pass; one more settles it. */
const FORCED_TICKS = 2;
/** A large campaign map takes several seconds to build on a contended machine. */
const MAP_TIMEOUT_MS = 120_000;

const SPAWNS = new Set(['SetHuman', 'SetHumanX', 'SetVehicle', 'SetHouse']);
const STAMPS = new Set([
  'ChangeHumanObjectIdInArea',
  'ChangeMissionIdOfHumanInRange',
  'ChangeMissionIdOfPlayer',
  'ChangeMissionIdOfVehicles',
  'ChangeMissionIdOfVehiclesInRange',
  'ChangeMissionIdOfPlayersVehiclesOnContinent',
]);
const HANDOVERS = new Set([
  'ChangePlayerPlayerId',
  'ChangePlayerIdInArea',
  'ChangeHumanPlayerId',
  'ChangeHousesPlayerId',
  'ChangeVehiclesPlayerId',
]);

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

function readScript(mapId: string): MapScript {
  return MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), `${mapId}.script.json`), 'utf8')));
}

function linesOf(script: MapScript, opcodes: ReadonlySet<string>): MapScriptLine[] {
  return script.missions.flatMap((mission) =>
    mission.results.filter((line) => opcodes.has(decodeMissionResult(line).opcode)),
  );
}

function handoverMaps(): string[] {
  if (!existsSync(mapsDir())) return [];
  return readdirSync(mapsDir())
    .filter((file) => file.endsWith('.script.json'))
    .map((file) => file.slice(0, -'.script.json'.length))
    .filter((mapId) => existsSync(resolve(mapsDir(), `${mapId}.json`)))
    .filter((mapId) => linesOf(readScript(mapId), HANDOVERS).length > 0)
    .sort();
}

/** The script with its own missions idle and one mission that runs every spawn, then every id stamp,
 *  then every handover, in authored order. */
function forcedScript(script: MapScript): MapScript {
  const forced = {
    debugName: 'forced handovers',
    other: [],
    active: true,
    goals: [{ key: 'goal', values: ['True'] }],
    results: [...linesOf(script, SPAWNS), ...linesOf(script, STAMPS), ...linesOf(script, HANDOVERS)],
  };
  return {
    ...script,
    missions: [...script.missions.map((mission) => ({ ...mission, active: false })), forced],
  };
}

/** One run: the person's seat, and the seats the session plays as another civilization (the person's
 *  first; any other is a computer seat), each with its chosen people. */
interface SeatCase {
  readonly mapId: string;
  readonly label: string;
  readonly person: number;
  readonly retribed: readonly (readonly [seat: number, chosen: number])[];
  /** A seat whose roster row is rewritten to another people, so two re-tribed seats each play the
   *  other's authored people. A thing one hands the other may then rightly carry the receiver's
   *  authored people, so only the net's silence is checked. */
  readonly swapped?: { readonly seat: number; readonly authored: number };
}

const otherPeople = (tribe: number): number => (tribe === BYZANTINE ? VIKING : BYZANTINE);

/** Every map from its first claimable civilization seat; a map with two also from its second, with
 *  both re-tribed at once, where a thing that reaches both takes the first seat's choice, and with the
 *  second authored as another people and the two playing each other's. */
function seatCases(): SeatCase[] {
  return handoverMaps().flatMap((mapId) => {
    const slots = mapLobbySlots(readScript(mapId)).filter(
      (slot) => slot.claimable && isCivilizationTribe(slot.tribeId),
    );
    const [first, second] = slots;
    if (first === undefined) return [];
    const away = (slot: (typeof slots)[number]) => [slot.player, otherPeople(slot.tribeId)] as const;
    const cases: SeatCase[] = [
      { mapId, label: 'its first seat', person: first.player, retribed: [away(first)] },
    ];
    if (second !== undefined) {
      const script = readScript(mapId);
      const swappedPeople = otherPeople(first.tribeId);
      cases.push(
        { mapId, label: 'its second seat', person: second.player, retribed: [away(second)] },
        { mapId, label: 'two re-tribed seats', person: first.player, retribed: [away(first), away(second)] },
      );
      if (
        !handsThroughThirdSeat(script, first.player, second.player) &&
        !handsPeopleToBoth(mapId, script, first.player, second.player, swappedPeople)
      ) {
        cases.push({
          mapId,
          label: "two seats playing each other's people",
          person: first.player,
          retribed: [
            [first.player, swappedPeople],
            [second.player, first.tribeId],
          ],
          swapped: { seat: second.player, authored: swappedPeople },
        });
      }
    }
    return cases;
  });
}

/** Whether a seat handed whole carries one of the two seats' things on to the other. The net judges a
 *  thing by the seat that handed it, so such a chain is a known limit: its things take the receiver's
 *  choice. */
function handsThroughThirdSeat(script: MapScript, a: number, b: number): boolean {
  const wholes = linesOf(script, new Set(['ChangePlayerPlayerId'])).map((line) => decodeMissionResult(line));
  const handed = (from: number, to: number): boolean =>
    wholes.some((op) => op.opcode === 'ChangePlayerPlayerId' && op.player === from && op.otherPlayer === to);
  const thirds = new Set(
    wholes.flatMap((op) => (op.opcode === 'ChangePlayerPlayerId' ? [op.player, op.otherPlayer] : [])),
  );
  return [...thirds].some(
    (third) =>
      third !== a &&
      third !== b &&
      ((handed(a, third) && handed(third, b)) || (handed(b, third) && handed(third, a))),
  );
}

/** Whether a by-id line hands one id to each of the two seats while a third seat's human or vehicle of
 *  that id carries `people`. The world build moves such a thing for one seat only, so the net corrects
 *  it when the other seat's handover delivers it instead. */
function handsPeopleToBoth(mapId: string, script: MapScript, a: number, b: number, people: number): boolean {
  const receivers = new Map<string, Set<number>>();
  const hand = (key: string, player: number): void => {
    const seats = receivers.get(key) ?? new Set<number>();
    seats.add(player);
    receivers.set(key, seats);
  };
  for (const line of linesOf(script, HANDOVERS)) {
    const op = decodeMissionResult(line);
    if (op.opcode === 'ChangeHumanPlayerId') hand(`human ${op.humanId}`, op.player);
    else if (op.opcode === 'ChangeVehiclesPlayerId') hand(`vehicle ${op.vehicleId}`, op.player);
  }
  const both = new Set(
    [...receivers].filter(([, seats]) => seats.has(a) && seats.has(b)).map(([key]) => key),
  );
  if (both.size === 0) return false;
  const name = (rawIrUnderTest() as ContentIr).tribes?.find((tribe) => tribe.typeId === people)?.id;
  const { entities } = TerrainMapFile.parse(
    JSON.parse(readFileSync(resolve(mapsDir(), `${mapId}.json`), 'utf8')),
  );
  const carries = (
    kind: string,
    things: readonly { player: number; tribe: string; missionId?: number | undefined }[],
  ) =>
    things.some(
      (thing) =>
        thing.player !== a &&
        thing.player !== b &&
        thing.tribe === name &&
        both.has(`${kind} ${thing.missionId}`),
    );
  return carries('human', entities?.humans ?? []) || carries('vehicle', entities?.vehicles ?? []);
}

/** The script with `swapped`'s roster row authored as its other people. */
function rosterOf(script: MapScript, swapped: SeatCase['swapped']): MapScript {
  if (swapped === undefined) return script;
  return {
    ...script,
    players: script.players.map((row) =>
      row.player === swapped.seat ? { ...row, tribeId: swapped.authored } : row,
    ),
  };
}

describe.runIf(hasRealIr())('a seat played as another civilization through its handovers', () => {
  it.each(seatCases())(
    '$mapId from $label moves everything handed to a re-tribed seat at world build',
    async ({ mapId, person, retribed, swapped }) => {
      const ir = rawIrUnderTest() as ContentIr;
      const { merge } = await loadContentUnderTest();
      const script = rosterOf(readScript(mapId), swapped);
      const slots = mapLobbySlots(script);
      const authored = new Map(slots.map((slot) => [slot.player, slot.tribeId]));
      const tribes = retribed.map(([seat, chosen]) => `${seat}:${chosen}`);
      const computers = retribed.map(([seat]) => seat).filter((seat) => seat !== person);
      const map = TerrainMapFile.parse(JSON.parse(readFileSync(resolve(mapsDir(), `${mapId}.json`), 'utf8')));
      const params = new URLSearchParams(
        `map=${mapId}&player=${person}&tribes=${tribes.join(',')}&seed=${SEED}` +
          (computers.length > 0 ? `&computer=${computers.join(',')}` : ''),
      );
      const { sim } = buildMapWorldFromInputs({
        map,
        ir,
        script: forcedScript(script),
        content: merge.content,
        session: mapSession(params, slots),
        missions: true,
        save: null,
      });
      const corrected: SimEvent[] = [];
      for (let tick = 0; tick < FORCED_TICKS; tick++) {
        sim.run(1);
        corrected.push(...sim.events.current().filter((event) => event.kind === 'missionSeatTribeCorrected'));
      }
      expect(corrected).toEqual([]);
      if (swapped !== undefined) return;

      // Houses are left out: a type the chosen people do not draw keeps its tribe by design.
      const { Owner, Person, Settler, Vehicle } = components;
      for (const [seat] of retribed) {
        const owned = (e: Entity) => sim.world.get(e, Owner).player === seat;
        const people = authored.get(seat);
        const settlersLeft = [...sim.world.query(Person, Settler, Owner)].filter(
          (e) =>
            owned(e) &&
            sim.world.get(e, Settler).tribe === people &&
            !systems.isHeroJob(merge.content, sim.world.get(e, Settler).jobType),
        );
        const vehiclesLeft = [...sim.world.query(Vehicle, Owner)].filter(
          (e) => owned(e) && sim.world.get(e, Vehicle).tribe === people,
        );
        expect({ seat, settlersLeft, vehiclesLeft }).toEqual({ seat, settlersLeft: [], vehiclesLeft: [] });
      }
    },
    MAP_TIMEOUT_MS,
  );
});
