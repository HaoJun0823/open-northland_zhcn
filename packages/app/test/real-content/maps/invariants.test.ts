import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  footprintCellDx,
  fullStateBlockAreaCells,
  type LandscapeBlockArea,
  MapMeta,
  MapScript,
  parseTerrainMap,
  type TerrainMapFile,
} from '@open-northland/data';
import { buildTerrainGraph, components, findPath, type NodeId, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { buildCollisionTerrain } from '../../../src/content/map/collision.js';
import { mapChestSpawns } from '../../../src/content/map/resources.js';
import { newWorldSim } from '../../../src/game/world/build.js';
import { contentDir, hasRealIr, loadContentUnderTest, rawIrUnderTest } from '../helpers.js';

/**
 * Cross-file invariants between the decoded maps (`<content>/maps/*.json`) and the IR - the seam
 * `parseTerrainMap`'s per-file schema cannot see: a map is only playable when every ground typeId
 * and placed-object name it carries resolves in the SAME pipeline run's ir.json, and every chest it
 * places authors a type the sim's contents table knows. Every map is also run through the real
 * loader's zod parse, so a truncated or lane-skewed emit fails here instead of at first open in the
 * browser. Skips without generated content (see `helpers.ts`).
 */

/** Zod over ~125 maps (~5.5M cells) takes seconds; whichever test parses first pays it once. Sized
 *  as a hang-guard with room for a CPU-contended full parallel run (observed timing out at 60s under
 *  multi-session machine load), not as a benchmark. */
const MAP_PARSE_TIMEOUT_MS = 180_000;

const WOODEN_CHEST_LOGIC_TYPE = 85;
const MAGICAL_CHEST_LOGIC_TYPE = 86;
const UNASSIGNED_MOD_CHEST_TYPE = 13;
/** The chest type the original campaigns author on chests whose reward their script pays. */
const SCRIPTED_CAMPAIGN_CHEST_TYPE = 100;
/** Nodes of one continent a component may hold without counting as joined to it: a lane saved before
 *  the map's last edit leaves a few nodes labelled with a continent they no longer touch. */
const STRAY_NODES = 5;
/** Welds the corpus may show where a map's saved continent lane is stale as a whole: on
 *  `kraina_tysisca_jezior_1_1` the original's own edge lane joins two lakes the continent lane
 *  numbers apart. */
const STALE_CONTINENT_WELDS = 1;
/** Building every graph of the corpus takes tens of seconds; sized as a hang guard. */
const CORPUS_GRAPH_TIMEOUT_MS = 600_000;

/** Named crossings from the owned corpus: map id, `[GfxLandscape]` EditName, and the half-cell node
 *  the map places it on. A corpus that moves one fails the placement assertion, not the routing one. */
const CROSSINGS = [
  { map: 'zgielk2', object: 'bridge small 01', hx: 224, hy: 71 },
  { map: 'zgielk2', object: 'bridge wood 02', hx: 66, hy: 89 },
] as const;
/** How far past a deck's end to look for its bank, in half-cell rows. Deep enough to clear the
 *  abutment's own build margin, shallow enough to stay on the near shore. */
const BANK_SEARCH_ROWS = 16;

function mapsDir(): string {
  return resolve(contentDir(), 'maps');
}

/** Decoded map grids: a map id is a dotless slug, so a dotted stem is a sidecar (`.meta.json`,
 *  `.script.json`, `.strings.json`, `.briefing.json` carry menu text, the script, the string table and
 *  the briefing, not terrain). */
function mapFiles(): string[] {
  return readdirSync(mapsDir())
    .filter((f) => f.endsWith('.json') && !f.slice(0, -'.json'.length).includes('.'))
    .sort();
}

let parsed: ReadonlyMap<string, TerrainMapFile> | null = null;

/** Zod-parse every map once for the whole file (~7s for the full 125-map set). */
function parsedMaps(): ReadonlyMap<string, TerrainMapFile> {
  parsed ??= new Map(
    mapFiles().map((f) => [f, parseTerrainMap(JSON.parse(readFileSync(resolve(mapsDir(), f), 'utf8')))]),
  );
  return parsed;
}

describe.runIf(hasRealIr() && existsSync(resolve(contentDir(), 'maps')))('decoded map invariants', () => {
  it(
    'ships at least one decoded map and every one passes the loader schema',
    () => {
      // parsedMaps() throws on the first schema-invalid file, naming it via the Map construction.
      expect(parsedMaps().size).toBeGreaterThan(0);
    },
    MAP_PARSE_TIMEOUT_MS,
  );

  it(
    'every ground typeId on every map resolves in the same run’s IR landscape table',
    async () => {
      const { real } = await loadContentUnderTest();
      const known = new Set(real.landscape.map((t) => t.typeId));
      for (const [file, map] of parsedMaps()) {
        const unknown = [...new Set(map.typeIds)].filter((t) => !known.has(t));
        expect(unknown, `map ${file} references landscape typeIds absent from ir.json`).toEqual([]);
      }
    },
    MAP_PARSE_TIMEOUT_MS,
  );

  it('every script sidecar passes the MapScript schema and most maps carry a Human slot', () => {
    const files = readdirSync(mapsDir())
      .filter((f) => f.endsWith('.script.json'))
      .sort();
    // The corpus ships playerdata on ~115 of the 125 maps; a run emitting none means the script
    // stage silently broke, not that the sources lost their rosters.
    expect(files.length).toBeGreaterThan(50);
    let withHumanSeat = 0;
    let withMultiplayerTable = 0;
    for (const f of files) {
      const script = MapScript.parse(JSON.parse(readFileSync(resolve(mapsDir(), f), 'utf8')));
      if (script.players.some((p) => p.type === 'human')) withHumanSeat++;
      if (script.multiplayer !== undefined) withMultiplayerTable++;
    }
    expect(withHumanSeat).toBeGreaterThan(50);
    // ~45 corpus maps author a [multiplayer] lobby table (player.inc/misc.inc/map.ini/map.cif);
    // zero means the section reader silently broke.
    expect(withMultiplayerTable).toBeGreaterThan(30);
  });

  it('every meta sidecar passes the MapMeta schema and most maps carry a maptype', () => {
    const files = readdirSync(mapsDir())
      .filter((f) => f.endsWith('.meta.json'))
      .sort();
    expect(files.length).toBeGreaterThan(100);
    let typed = 0;
    for (const f of files) {
      const meta = MapMeta.parse(JSON.parse(readFileSync(resolve(mapsDir(), f), 'utf8')));
      if (meta.mapTypes !== undefined) typed++;
    }
    // Every corpus map declares a maptype; a run emitting none means the header reader silently
    // broke, which would list every map in every menu.
    expect(typed).toBeGreaterThan(100);
  });

  it(
    'every placed landscape object name on every map resolves in the IR landscapeGfx table',
    () => {
      // The collision/resource joins key placed objects by their [GfxLandscape] editName; a name the
      // IR lacks silently drops the object (no footprint, no resource) instead of erroring.
      const irRaw = rawIrUnderTest() as { landscapeGfx?: readonly { editName: string }[] };
      const known = new Set((irRaw.landscapeGfx ?? []).map((g) => g.editName));
      expect(known.size).toBeGreaterThan(0);
      for (const [file, map] of parsedMaps()) {
        const unknown = (map.objects?.types ?? []).filter((n) => !known.has(n));
        expect(unknown, `map ${file} places objects absent from ir.json landscapeGfx`).toEqual([]);
      }
    },
    MAP_PARSE_TIMEOUT_MS,
  );

  it(
    'every authored vehicle names a type the IR carries, and every crew row sits on one of them',
    async () => {
      // A crew row names its vehicle by the half-cell the `setvehicle` placed it on, so a coordinate no
      // vehicle stands on would strand the settler.
      const { real } = await loadContentUnderTest();
      const known = new Set(real.vehicles.flatMap((v) => [v.id, v.name ?? v.id]));
      let crews = 0;
      for (const [file, map] of parsedMaps()) {
        const placed = map.entities?.vehicles ?? [];
        const unknown = placed.map((v) => v.type).filter((t) => !known.has(t));
        expect(unknown, `map ${file} places vehicle types absent from ir.json`).toEqual([]);
        const spots = new Set(placed.map((v) => `${v.hx},${v.hy}`));
        for (const human of map.entities?.humans ?? []) {
          const crew = human.boardVehicleAt;
          if (crew === undefined) continue;
          crews++;
          expect(spots.has(`${crew.hx},${crew.hy}`), `map ${file} crews a vehicle no setvehicle placed`).toBe(
            true,
          );
        }
      }
      expect(crews).toBeGreaterThan(0);
    },
    MAP_PARSE_TIMEOUT_MS,
  );

  it(
    'the chest join finds both chest records, and every map authors a known type on every chest',
    () => {
      // The sim opens a chest empty when its authored type is not in the contents table, so a gap there
      // turns a treasure into nothing with no symptom.
      const ir = rawIrUnderTest() as ContentIr;
      const chestRecords = (ir.landscapeGfx ?? []).filter(
        (g) => g.logicType === WOODEN_CHEST_LOGIC_TYPE || g.logicType === MAGICAL_CHEST_LOGIC_TYPE,
      );
      expect(chestRecords.map((g) => g.editName).sort()).toEqual(['chest magical', 'chest wooden']);
      let chests = 0;
      const unknown = new Set<number>();
      for (const map of parsedMaps().values()) {
        if (map.objects === undefined) continue;
        for (const chest of mapChestSpawns(map.objects, ir)) {
          chests++;
          if (!systems.CHEST_CONTENTS.has(chest.contents)) unknown.add(chest.contents);
        }
      }
      expect(chests).toBeGreaterThan(0);
      // The original's open-chest dispatch hands out types 1 to 96 only; any other type opens empty.
      // Ten mod-map chests author type 13, a row the original lacks as well. Fifteen chests on five
      // original campaign maps author 100, which no `chesttypes` table names: their script pays the
      // reward (wonder-campaign_03_02 adds stone and coin once `ChestNearPos` sees the chest opened).
      // Any other unknown type is a table gap.
      expect(
        [...unknown].sort((a, b) => a - b),
        'chest types the table does not know',
      ).toEqual([UNASSIGNED_MOD_CHEST_TYPE, SCRIPTED_CAMPAIGN_CHEST_TYPE]);
    },
    MAP_PARSE_TIMEOUT_MS,
  );
  it(
    'carries a decoded fish table through terrain assembly into persistent sim entities',
    async () => {
      const authored = [...parsedMaps().values()].find((map) => (map.fishSwarms?.length ?? 0) > 0);
      if (authored?.fishSwarms === undefined) throw new Error('no decoded map carries a fish table');
      const { merge } = await loadContentUnderTest();
      const sim = newWorldSim(
        1,
        buildCollisionTerrain(authored, rawIrUnderTest() as ContentIr),
        merge.content,
      );
      const entities = [...sim.world.query(components.FishSwarm, components.Position)];
      expect(entities).toHaveLength(authored.fishSwarms.length);
      const [first] = entities;
      const [source] = authored.fishSwarms;
      if (first === undefined || source === undefined) throw new Error('first authored swarm missing');
      expect(sim.world.get(first, components.FishSwarm)).toMatchObject({
        count: source.count,
        continent: source.continent,
      });
    },
    MAP_PARSE_TIMEOUT_MS,
  );

  // Every map's `lmco` lane numbers each node's continent, 0 for void and for pockets too small to
  // number. A continent can run through the map frame or across an edge a rock triangle cuts, where no
  // walker or ship of the original passes, so a component of ours may split a continent, never hold
  // two. With the map's objects stripped, as the lane is computed, a regression in the ground classes
  // or the edge rule welds them.
  it(
    'never joins two of the original continents into one ground component',
    async () => {
      const { merge } = await loadContentUnderTest();
      const ir = rawIrUnderTest() as ContentIr;
      const welds: string[] = [];
      let compared = 0;
      for (const [file, map] of parsedMaps()) {
        const continents = map.continents;
        if (continents === undefined || map.ground === undefined) continue;
        compared++;
        const { objects: _objects, ...ground } = map;
        const graph = buildTerrainGraph(merge.content, buildCollisionTerrain(ground, ir));
        const continentsOf = new Map<number, Map<number, number>>();
        for (let i = 0; i < graph.nodeCount; i++) {
          const node = i as NodeId;
          const continent = continents[i] ?? 0;
          // A node no mover stands on, the frame's among them, belongs to no component.
          if (continent === 0 || !(graph.isWalkable(node) || graph.isWater(node))) continue;
          const component = graph.componentOf(node);
          let held = continentsOf.get(component);
          if (held === undefined) {
            held = new Map();
            continentsOf.set(component, held);
          }
          held.set(continent, (held.get(continent) ?? 0) + 1);
        }
        for (const held of continentsOf.values()) {
          const joined = [...held].filter(([, nodes]) => nodes > STRAY_NODES).map(([continent]) => continent);
          if (joined.length > 1) welds.push(`${file}: continents ${joined.join(', ')}`);
        }
      }
      expect(compared).toBeGreaterThan(0);
      expect(welds.length, welds.join('\n')).toBeLessThanOrEqual(STALE_CONTINENT_WELDS);
    },
    CORPUS_GRAPH_TIMEOUT_MS,
  );

  // A bridge is a parapet outline whose corridor runs over cells the mapmaker painted half land, half
  // water; the collision join has to keep both open at once or the deck stops being a crossing.
  for (const crossing of CROSSINGS) {
    it(
      `${crossing.object} on ${crossing.map} joins its two banks over the deck`,
      async () => {
        const { merge } = await loadContentUnderTest();
        const ir = rawIrUnderTest() as ContentIr;
        const map = parsedMaps().get(`${crossing.map}.json`);
        if (map === undefined) throw new Error(`no decoded ${crossing.map}`);
        const objects = map.objects;
        if (objects === undefined) throw new Error(`${crossing.map} carries no object lane`);
        const typeIndex = objects.types.indexOf(crossing.object);
        expect(typeIndex, `${crossing.map} no longer places '${crossing.object}'`).toBeGreaterThanOrEqual(0);
        let placed = false;
        for (let i = 0; i + 2 < objects.placements.length; i += 3) {
          if (objects.placements[i + 2] !== typeIndex) continue;
          if (objects.placements[i] === crossing.hx && objects.placements[i + 1] === crossing.hy)
            placed = true;
        }
        expect(placed, `'${crossing.object}' no longer sits at (${crossing.hx},${crossing.hy})`).toBe(true);

        const gfx = ir.landscapeGfx?.find((g) => g.editName === crossing.object);
        const deck = fullStateBlockAreaCells(
          gfx?.walkBlockAreas as readonly LandscapeBlockArea[] | undefined,
        );
        expect(deck.length, `'${crossing.object}' has no walk area to cross`).toBeGreaterThan(0);
        const dys = deck.map((c) => c.dy);
        const dxs = deck.map((c) => c.dx);
        const [minDy, maxDy] = [Math.min(...dys), Math.max(...dys)];
        const [minDx, maxDx] = [Math.min(...dxs), Math.max(...dxs)];

        const grid = buildCollisionTerrain(map, ir);
        const graph = buildTerrainGraph(merge.content, grid);
        const walkableAt = (dx: number, dy: number): NodeId | null => {
          const x = crossing.hx + footprintCellDx(crossing.hy, { dx, dy });
          const y = crossing.hy + dy;
          if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
          const node = graph.nodeAt(x, y);
          return graph.isWalkable(node) ? node : null;
        };
        /** The first walkable node past one end of the deck, scanning outwards across its width. */
        const bank = (from: number, step: number): NodeId | null => {
          for (let k = 1; k <= BANK_SEARCH_ROWS; k++) {
            for (let dx = minDx; dx <= maxDx; dx++) {
              const node = walkableAt(dx, from + step * k);
              if (node !== null) return node;
            }
          }
          return null;
        };
        const near = bank(minDy, -1);
        const far = bank(maxDy, 1);
        expect(near, 'no walkable node past the deck’s far end').not.toBeNull();
        expect(far, 'no walkable node past the deck’s near end').not.toBeNull();
        if (near === null || far === null) return;

        const route = findPath(graph, near, far);
        expect(route, 'the two banks no longer route into each other').not.toBeNull();
        // The route crosses the deck rather than walking round the whole water body.
        const overDeck = (route ?? []).some((node) => {
          const dy = Math.floor(node / grid.width) - crossing.hy;
          if (dy < minDy || dy > maxDy) return false;
          const x = node % grid.width;
          return (
            x >= crossing.hx + footprintCellDx(crossing.hy, { dx: minDx, dy }) &&
            x <= crossing.hx + footprintCellDx(crossing.hy, { dx: maxDx, dy })
          );
        });
        expect(overDeck, 'the banks connect somewhere else, not over this deck').toBe(true);
      },
      MAP_PARSE_TIMEOUT_MS,
    );
  }
});
