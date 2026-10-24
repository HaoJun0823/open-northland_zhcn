import { type ContentSet, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { Building, Health, Person, Settler } from '../../../src/components/index.js';
import type { Entity } from '../../../src/ecs/world.js';
import { Simulation } from '../../../src/index.js';
import type { MissionResultOp, MissionSeatTribe } from '../../../src/systems/missions/index.js';
import { missionObjects } from '../../../src/systems/missions/index.js';
import { grassNodeMap } from '../../fixtures/terrain.js';
import {
  enableMissions,
  FRANK,
  firingMission,
  HUT,
  houseContent,
  LOAD_PASS,
  MAP_NODES,
  POINT,
  runLoadPass,
  VIKING,
  WOODCUTTER,
} from './support.js';

/** A handover that delivers the re-tribed seat's authored people moves them to the chosen people. */

const SARACEN = 4;
const PERSON_SEAT = 0;
const COMPUTER_SEAT = 2;
const STAGING_SEAT = 3;
/** `hero_saber_hatschi` in the fixture content. */
const HERO = 45;
const VIKING_ID = 70;
const FRANK_ID = 71;
const HERO_ID = 72;
const HOUSE_ID = 73;

const SEAT: MissionSeatTribe = {
  player: PERSON_SEAT,
  authored: VIKING,
  chosen: SARACEN,
  drawnBuildings: [HUT],
};

const spawnHuman = (tribe: number, job: number, humanId: number, player = STAGING_SEAT): MissionResultOp => ({
  opcode: 'SetHuman',
  player,
  tribe,
  job,
  point: { hx: POINT.hx + humanId - VIKING_ID, hy: POINT.hy },
  humanId,
  behaviour: 0,
});

const VIKING_HUT_HITPOINTS = 100;
const SARACEN_HUT_HITPOINTS = 200;
/** A quarter of the viking hut's hit points, a fraction both pools divide evenly. */
const DAMAGED_HUT_HITPOINTS = VIKING_HUT_HITPOINTS / 4;

/** The hut as real content carries it: each people's own variant with its own footprint object and hit
 *  points, the saracen one shifted by `shift` cells. */
function variantContent(shift: number): ContentSet {
  const base = houseContent();
  const viking = base.tribes.find((tribe) => tribe.typeId === VIKING);
  return parseContentSet({
    ...base,
    tribes:
      viking === undefined ? base.tribes : [...base.tribes, { ...viking, typeId: SARACEN, id: 'saracen' }],
    buildings: base.buildings.map((type) => {
      const footprint = type.footprint;
      if (type.typeId !== HUT || footprint === undefined) return type;
      const moved = { ...footprint, blocked: footprint.blocked.map((c) => ({ dx: c.dx + shift, dy: c.dy })) };
      return {
        ...type,
        tribeVariants: [
          { tribe: VIKING, footprint: structuredClone(footprint), hitpoints: VIKING_HUT_HITPOINTS },
          { tribe: SARACEN, footprint: moved, hitpoints: SARACEN_HUT_HITPOINTS },
        ],
      };
    }),
  });
}

function handoverSim(
  handovers: readonly MissionResultOp[],
  seatTribes: readonly MissionSeatTribe[],
  content: ContentSet = variantContent(0),
) {
  const sim = new Simulation({
    seed: 1,
    content,
    map: grassNodeMap(MAP_NODES, MAP_NODES),
    missions: {
      missions: [
        firingMission([
          spawnHuman(VIKING, WOODCUTTER, VIKING_ID),
          spawnHuman(FRANK, WOODCUTTER, FRANK_ID),
          spawnHuman(VIKING, HERO, HERO_ID),
          {
            opcode: 'SetHouse',
            player: STAGING_SEAT,
            houseName: { typeId: HUT, tribe: VIKING },
            level: 0,
            built: true,
            point: { hx: POINT.hx, hy: POINT.hy + 10 },
            objectId: HOUSE_ID,
          },
          ...handovers,
        ]),
      ],
      seatTribes,
    },
  });
  enableMissions(sim);
  sim.run(LOAD_PASS);
  return sim;
}

function tribeOf(sim: Simulation, id: number): number | undefined {
  const e: Entity | undefined = missionObjects(sim.world, id)[0];
  if (e === undefined) return undefined;
  return sim.world.has(e, Person) ? sim.world.get(e, Settler).tribe : sim.world.tryGet(e, Building)?.tribe;
}

const corrections = (sim: Simulation) =>
  sim.events.current().filter((event) => event.kind === 'missionSeatTribeCorrected');

describe('the handover safety net', () => {
  it("moves a handed seat's authored people, keeping another people and a hero", () => {
    const sim = handoverSim(
      [{ opcode: 'ChangePlayerPlayerId', player: STAGING_SEAT, otherPlayer: PERSON_SEAT }],
      [SEAT],
    );
    expect(tribeOf(sim, VIKING_ID)).toBe(SARACEN);
    expect(tribeOf(sim, FRANK_ID)).toBe(FRANK);
    expect(tribeOf(sim, HERO_ID)).toBe(VIKING);
    expect(tribeOf(sim, HOUSE_ID)).toBe(SARACEN);
    const house = missionObjects(sim.world, HOUSE_ID)[0];
    expect(house === undefined ? undefined : sim.world.get(house, Health)).toMatchObject({
      hitpoints: SARACEN_HUT_HITPOINTS,
      max: SARACEN_HUT_HITPOINTS,
    });
    expect(corrections(sim)).toEqual([
      { kind: 'missionSeatTribeCorrected', mission: 0, opcode: 'ChangePlayerPlayerId', count: 2 },
    ]);
  });

  it('moves a human handed by id, and keeps a house the chosen people do not draw without reporting it', () => {
    const sim = handoverSim(
      [
        { opcode: 'ChangeHumanPlayerId', humanId: VIKING_ID, player: PERSON_SEAT },
        { opcode: 'ChangeHousesPlayerId', objectId: HOUSE_ID, player: PERSON_SEAT },
      ],
      [{ ...SEAT, drawnBuildings: [] }],
    );
    expect(tribeOf(sim, VIKING_ID)).toBe(SARACEN);
    expect(tribeOf(sim, HOUSE_ID)).toBe(VIKING);
    expect(corrections(sim).map((event) => event.opcode)).toEqual(['ChangeHumanPlayerId']);
  });

  it('keeps a handed house whose footprint cells differ between the two peoples', () => {
    const sim = handoverSim(
      [{ opcode: 'ChangeHousesPlayerId', objectId: HOUSE_ID, player: PERSON_SEAT }],
      [SEAT],
      variantContent(1),
    );
    expect(tribeOf(sim, HOUSE_ID)).toBe(VIKING);
    expect(corrections(sim)).toEqual([]);
  });

  it("rescales a damaged house to its health fraction of the chosen people's hit points", () => {
    const sim = new Simulation({
      seed: 1,
      content: variantContent(0),
      map: grassNodeMap(MAP_NODES, MAP_NODES),
      missions: {
        missions: [
          firingMission([{ opcode: 'ChangeHousesPlayerId', objectId: HOUSE_ID, player: PERSON_SEAT }]),
        ],
        seatTribes: [SEAT],
      },
    });
    sim.enqueueSetup({
      kind: 'placeBuilding',
      buildingType: HUT,
      tribe: VIKING,
      x: POINT.hx,
      y: POINT.hy,
      owner: STAGING_SEAT,
      underConstruction: false,
      force: true,
      missionId: HOUSE_ID,
    });
    sim.step();
    const house = missionObjects(sim.world, HOUSE_ID)[0];
    if (house === undefined) throw new Error('the hut was not placed');
    expect(sim.world.get(house, Health).max).toBe(VIKING_HUT_HITPOINTS);
    sim.world.mut(house, Health).hitpoints = DAMAGED_HUT_HITPOINTS;
    runLoadPass(sim);
    expect(tribeOf(sim, HOUSE_ID)).toBe(SARACEN);
    expect(sim.world.get(house, Health)).toMatchObject({
      hitpoints: (DAMAGED_HUT_HITPOINTS * SARACEN_HUT_HITPOINTS) / VIKING_HUT_HITPOINTS,
      max: SARACEN_HUT_HITPOINTS,
    });
  });

  it("leaves a thing of another re-tribed seat carrying that seat's choice", () => {
    // Seat 0 plays its authored vikings as franks, seat 2 its authored franks as vikings: the frank the
    // build placed on seat 0 is seat 0's choice, not seat 2's authored people.
    const sim = new Simulation({
      seed: 1,
      content: variantContent(0),
      map: grassNodeMap(MAP_NODES, MAP_NODES),
      missions: {
        missions: [
          firingMission([
            spawnHuman(FRANK, WOODCUTTER, FRANK_ID, PERSON_SEAT),
            { opcode: 'ChangeHumanPlayerId', humanId: FRANK_ID, player: COMPUTER_SEAT },
          ]),
        ],
        seatTribes: [
          { player: PERSON_SEAT, authored: VIKING, chosen: FRANK, drawnBuildings: [HUT] },
          { player: COMPUTER_SEAT, authored: FRANK, chosen: VIKING, drawnBuildings: [HUT] },
        ],
      },
    });
    enableMissions(sim);
    sim.run(LOAD_PASS);
    expect(tribeOf(sim, FRANK_ID)).toBe(FRANK);
    expect(corrections(sim)).toEqual([]);
  });

  it('leaves a thing handed again to the seat that already holds it', () => {
    // Seat 2 hands its viking (its choice) to seat 0, whose authored people are vikings; a second line
    // handing the same id to seat 0 delivers nothing, so the giver's choice stands.
    const handToPerson: MissionResultOp = {
      opcode: 'ChangeHumanPlayerId',
      humanId: VIKING_ID,
      player: PERSON_SEAT,
    };
    const sim = new Simulation({
      seed: 1,
      content: variantContent(0),
      map: grassNodeMap(MAP_NODES, MAP_NODES),
      missions: {
        missions: [
          firingMission([
            spawnHuman(VIKING, WOODCUTTER, VIKING_ID, COMPUTER_SEAT),
            handToPerson,
            handToPerson,
          ]),
        ],
        seatTribes: [
          { player: PERSON_SEAT, authored: VIKING, chosen: FRANK, drawnBuildings: [HUT] },
          { player: COMPUTER_SEAT, authored: FRANK, chosen: VIKING, drawnBuildings: [HUT] },
        ],
      },
    });
    enableMissions(sim);
    sim.run(LOAD_PASS);
    expect(tribeOf(sim, VIKING_ID)).toBe(VIKING);
    expect(corrections(sim)).toEqual([]);
  });

  it('stays silent for a seat the session plays as the map authored it', () => {
    const sim = handoverSim(
      [{ opcode: 'ChangePlayerPlayerId', player: STAGING_SEAT, otherPlayer: PERSON_SEAT }],
      [],
    );
    expect(tribeOf(sim, VIKING_ID)).toBe(VIKING);
    expect(corrections(sim)).toEqual([]);
  });
});
