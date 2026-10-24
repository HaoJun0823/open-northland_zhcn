import { describe, expect, it } from 'vitest';
import { buildTerrainGraph } from '../../src/index.js';
import { NodeMask } from '../../src/nav/block-overlay.js';
import { StepBuffer } from '../../src/nav/terrain/step-buffer.js';
import { testContent } from '../fixtures/content.js';
import { rawGrid } from './terrain/support.js';

const DIRECTIONS = [
  [1, -2],
  [1, 2],
  [-1, 2],
  [-1, -2],
] as const;

describe('diagonal collision on the staggered lattice', () => {
  for (const row of [2, 3]) {
    for (const [dx, dy] of DIRECTIONS) {
      it.each(['land', 'water'] as const)(
        `requires the actual midpoint from row ${row} along ${dx},${dy} on %s`,
        (traversal) => {
          const map = rawGrid(7, 8);
          const terrain = buildTerrainGraph(testContent(), {
            ...map,
            typeIds: map.typeIds.map(() => (traversal === 'water' ? 1 : 0)),
          });
          const from = terrain.nodeAt(3, row);
          const to = terrain.nodeAt(3 + dx, row + dy);
          const midpointX = 3 + (row & 1) - (dx < 0 ? 1 : 0);
          const midpoint = terrain.nodeAt(midpointX, row + dy / 2);
          const other = terrain.nodeAt(midpointX === 3 ? 3 + dx : 3, row + dy / 2);
          const blocked = new NodeMask(terrain.nodeCount);
          const steps = new StepBuffer();
          const connects = () => {
            terrain.stepsInto(from, blocked, steps, traversal);
            return Array.from({ length: steps.length }, (_, i) => steps.nodeAt(i)).includes(to);
          };
          expect(connects()).toBe(true);
          blocked.set(other, true);
          expect(connects()).toBe(true);
          blocked.set(other, false);
          blocked.set(midpoint, true);
          expect(connects()).toBe(false);
          // Reverse searches must see the same joint and cannot borrow the other flank either.
          terrain.stepsInto(to, new Set([midpoint]), steps, traversal);
          expect(Array.from({ length: steps.length }, (_, i) => steps.nodeAt(i))).not.toContain(from);
        },
      );
      it(`honours static terrain at the midpoint from row ${row} along ${dx},${dy}`, () => {
        const terrain = buildTerrainGraph(
          testContent(),
          rawGrid(7, 8, [[3 + (row & 1) - (dx < 0 ? 1 : 0), row + dy / 2]]),
        );
        expect(terrain.steps(terrain.nodeAt(3, row)).map((step) => step.node)).not.toContain(
          terrain.nodeAt(3 + dx, row + dy),
        );
      });
    }
  }
});
