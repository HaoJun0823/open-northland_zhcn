import { footprintCellDx, levelBlockAreaCells } from '@open-northland/data';
import { buildTerrainGraph, type NodeId } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { TERRAIN_OPEN } from '../../src/catalog/terrain.js';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { hasRealIr, loadContentUnderTest, rawIrUnderTest } from './helpers.js';

/** Exercise every shipped footprint and state, including dungeon pieces, fortifications, trees,
 * rocks and open gates, on both anchor parities. The map-independent rule must not need a wall list. */
describe.runIf(hasRealIr())('all landscape collision footprints', () => {
  it('never borrows the open flank beside a blocked diagonal midpoint', async () => {
    const ir = rawIrUnderTest() as ContentIr;
    const { merge } = await loadContentUnderTest();
    const width = 96;
    const terrain = buildTerrainGraph(merge.content, {
      resolution: 'half-cell',
      width,
      height: width,
      typeIds: new Array<number>(width * width).fill(TERRAIN_OPEN),
    });
    const failures: string[] = [];
    let checked = 0;
    for (const row of ir.landscapeGfx ?? []) {
      const levels = new Set(row.walkBlockAreas?.map(([state]) => state));
      for (const level of levels)
        for (const hy of [46, 47]) {
          const blocked = new Set<NodeId>();
          for (const cell of levelBlockAreaCells(row.walkBlockAreas, level)) {
            const x = 46 + footprintCellDx(hy, cell),
              y = hy + cell.dy;
            if (!terrain.inBounds(x, y)) throw new Error(`footprint exceeds test ground: ${row.editName}`);
            blocked.add(terrain.nodeAt(x, y));
          }
          for (const middle of blocked) {
            const mx = terrain.xOf(middle),
              my = terrain.yOf(middle);
            for (const dx of [-1, 1])
              for (const dy of [-2, 2]) {
                const sy = my - dy / 2;
                const sx = mx - (sy & 1) + (dx < 0 ? 1 : 0);
                if (!terrain.inBounds(sx, sy) || !terrain.inBounds(sx + dx, sy + dy)) continue;
                const start = terrain.nodeAt(sx, sy),
                  end = terrain.nodeAt(sx + dx, sy + dy);
                const other = terrain.nodeAt(mx === sx ? sx + dx : sx, my);
                if (blocked.has(start) || blocked.has(end) || blocked.has(other)) continue;
                expect(terrain.steps(start).some((step) => step.node === end)).toBe(true);
                checked++;
                if (terrain.steps(start, blocked).some((step) => step.node === end))
                  failures.push(
                    `${row.editName}, level ${level}, anchor row ${hy}: ${sx},${sy} -> ${sx + dx},${sy + dy}`,
                  );
              }
          }
        }
    }
    expect(checked).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});
