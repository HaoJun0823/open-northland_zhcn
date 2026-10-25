import { describe, expect, it } from 'vitest';
import { PathFollow, PathRoute, Position } from '../../../src/components/index.js';
import { type Fixed, fx, ONE } from '../../../src/core/fixed.js';
import type { Entity } from '../../../src/ecs/world.js';
import type { Simulation } from '../../../src/index.js';
import { nodeOfPosition, nodeWorldX, positionOfNode, positionXOfWorld } from '../../../src/nav/halfcell.js';
import type { TerrainGraph } from '../../../src/nav/terrain/index.js';
import { evictSettlersFromCells, settlersByNode } from '../../../src/systems/movement/evict.js';
import { dropPath } from '../../../src/systems/movement/nav-state.js';
import { moverNode } from '../../../src/systems/spatial/mover-node.js';
import { entityNode } from '../../../src/systems/spatial/nodes.js';
import { ctxOf } from '../../fixtures/context.js';
import { P0, SOLDIER, settlerAt, sim } from '../movement/separation/support.js';

// A column step from (6, 2) to (6, 4), passing between (5, 3) and (6, 3) on the row it skips.
const COLUMN_HX = 6;
const FROM_HY = 2;
const TO_HY = 4;
const SKIPPED_HY = 3;
const EAST_MIDDLE_HX = COLUMN_HX;
/** How far a push holds the walker east of the step's line, in columns. */
const PUSH = fx.div(ONE, fx.fromInt(32));
const SAMPLES = 64;

interface Point {
  x: Fixed;
  y: Fixed;
}

function terrainOf(s: Simulation): TerrainGraph {
  if (s.terrain === undefined) throw new Error('mapped sim expected');
  return s.terrain;
}

function columnStepper(s: Simulation): Entity {
  const terrain = terrainOf(s);
  const walker = settlerAt(s, COLUMN_HX, FROM_HY, SOLDIER, P0);
  const waypoints = [FROM_HY, TO_HY].map((hy) => ({
    ...positionOfNode(COLUMN_HX, hy),
    node: terrain.nodeAt(COLUMN_HX, hy),
  }));
  s.world.add(walker, PathRoute, { waypoints });
  s.world.add(walker, PathFollow, { index: 1, legElapsed: 0, legCost: 0 });
  return walker;
}

/** Sample `i` of {@link SAMPLES} along the step, held {@link PUSH} east of its line. */
function pushedAlongStep(i: number): Point {
  const from = positionOfNode(COLUMN_HX, FROM_HY);
  const to = positionOfNode(COLUMN_HX, TO_HY);
  const y = fx.add(from.y, fx.div(fx.mul(fx.sub(to.y, from.y), fx.fromInt(i)), fx.fromInt(SAMPLES)));
  return { x: positionXOfWorld(fx.add(nodeWorldX(COLUMN_HX, FROM_HY), PUSH), y), y };
}

/** The first pushed sample whose position alone reads the skipped row. */
function sampleOnSkippedRow(): Point {
  for (let i = 0; i <= SAMPLES; i++) {
    const at = pushedAlongStep(i);
    if (nodeOfPosition(at.x, at.y).hy === SKIPPED_HY) return at;
  }
  throw new Error('the push no longer reads the skipped row by position');
}

function moveTo(s: Simulation, e: Entity, at: Point): void {
  const p = s.world.mut(e, Position);
  p.x = at.x;
  p.y = at.y;
}

describe('moverNode', () => {
  it('reads a pushed column stepper on the start until the skipped row and on the end past it', () => {
    const s = sim();
    const walker = columnStepper(s);
    const skippedY = positionOfNode(COLUMN_HX, SKIPPED_HY).y;
    for (let i = 0; i <= SAMPLES; i++) {
      const at = pushedAlongStep(i);
      const hy = at.y > skippedY ? TO_HY : FROM_HY;
      expect(moverNode(s.world, walker, at)).toEqual({ hx: COLUMN_HX, hy });
    }
  });

  it('keeps a pushed column stepper off the middle in the node index and out of its eviction', () => {
    const s = sim();
    const terrain = terrainOf(s);
    const walker = columnStepper(s);
    const at = sampleOnSkippedRow();
    moveTo(s, walker, at);
    const middle = terrain.nodeAt(EAST_MIDDLE_HX, SKIPPED_HY);
    expect(entityNode(s.world, terrain, walker)).not.toBe(middle);
    expect(settlersByNode(s.world).at(EAST_MIDDLE_HX, SKIPPED_HY)).toEqual([]);

    evictSettlersFromCells(s.world, ctxOf(s), terrain, new Set([middle]), 'move');
    expect(s.world.get(walker, Position)).toEqual(at);
    expect(s.world.verifyCaches()).toEqual([]);
  });

  it('moves the node index when a dropped route ends the column step without a Position write', () => {
    const s = sim();
    const walker = columnStepper(s);
    moveTo(s, walker, sampleOnSkippedRow());
    expect(settlersByNode(s.world).at(EAST_MIDDLE_HX, SKIPPED_HY)).toEqual([]);

    dropPath(s.world, walker);
    expect(settlersByNode(s.world).at(EAST_MIDDLE_HX, SKIPPED_HY)).toEqual([walker]);
    expect(s.world.verifyCaches()).toEqual([]);
  });
});
