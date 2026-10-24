import type { ContentSet } from '@open-northland/data';
import type { EntityBounds } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import {
  JOB_ARCHER,
  JOB_ARCHER_LONG,
  JOB_BUILDER,
  JOB_COLLECTOR,
  JOB_HERO_UNARMED,
  JOB_HEROINE_BOW,
  JOB_HUNTER,
  JOB_SOLDIER_BROADSWORD,
  JOB_SOLDIER_SPEAR,
  JOB_SOLDIER_SWORD,
  JOB_WOMAN,
} from '../../../src/catalog/jobs.js';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import type { Pickable } from '../../../src/view/picking.js';
import { jobMateArea, jobMatesIn } from '../../../src/view/unit-controls/job-mates.js';
import { settler, snapshotOf } from '../../support/snapshot.js';

const content = sandboxContent();

const drawn = (ref: number, x: number, y: number, box?: EntityBounds): Pickable => ({
  ref,
  x,
  y,
  kind: 'settler',
  box,
});

describe('double-click job mates', () => {
  const AREA = { minX: 600, minY: 700, maxX: 1400, maxY: 1300 };

  it('gathers the clicked trade whose sprite touches the area', () => {
    const snapshot = snapshotOf([
      settler(1, JOB_BUILDER, null),
      settler(2, JOB_BUILDER, null),
      settler(3, JOB_COLLECTOR, null),
      settler(4, JOB_BUILDER, null),
      settler(5, JOB_BUILDER, null),
      settler(6, JOB_BUILDER, null),
    ]);
    const settlers = [
      drawn(1, 1000, 1040),
      drawn(2, 1400, 1300), // feet on the area's corner, no bounds
      drawn(3, 1010, 1010), // another trade
      drawn(4, 1450, 1000, { minX: 1430, minY: 930, maxX: 1470, maxY: 1000 }), // wholly past the side
      // Feet past the bottom, but drawn up a hill with its body inside.
      drawn(5, 1000, 1360, { minX: 980, minY: 1250, maxX: 1020, maxY: 1320 }),
      // 6 is a builder the frame did not draw, so it is no candidate at all
    ];

    expect(jobMatesIn(settlers, 1, AREA, snapshot, content)).toEqual([1, 2, 5]);
  });

  it('grows the screen by the same screen-px margin at every zoom', () => {
    const MARGIN = 96;
    const SCREEN = { width: 1280, height: 800 };
    for (const scale of [0.5, 1, 2]) {
      const camera = { offsetX: -100, offsetY: -50, scale };
      const area = jobMateArea(camera, SCREEN.width, SCREEN.height);
      const toScreenX = (x: number): number => x * scale + camera.offsetX;
      const toScreenY = (y: number): number => y * scale + camera.offsetY;
      expect([
        toScreenX(area.minX),
        toScreenX(area.maxX),
        toScreenY(area.minY),
        toScreenY(area.maxY),
      ]).toEqual([-MARGIN, SCREEN.width + MARGIN, -MARGIN, SCREEN.height + MARGIN]);
    }
  });

  it('keeps weapon families apart, joins their tiers, and keeps heroes and workers separate', () => {
    // The sandbox catalog holds no hero trade; the served content names every one of them `hero*`.
    const withHeroes: ContentSet = {
      ...content,
      jobs: content.jobs.flatMap((job) =>
        job.typeId === JOB_WOMAN
          ? [
              job,
              { ...job, id: 'hero_unarmed', typeId: JOB_HERO_UNARMED },
              { ...job, id: 'heroine_bow_xena', typeId: JOB_HEROINE_BOW },
            ]
          : [job],
      ),
    };
    const snapshot = snapshotOf(
      [
        settler(1, JOB_HERO_UNARMED, null),
        settler(2, JOB_HEROINE_BOW, null),
        settler(3, JOB_ARCHER, null),
        settler(4, JOB_SOLDIER_SWORD, null),
        settler(5, JOB_BUILDER, null),
        settler(6, JOB_ARCHER_LONG, null),
        settler(7, JOB_SOLDIER_SPEAR, null),
        settler(8, JOB_SOLDIER_BROADSWORD, null),
        settler(9, JOB_HUNTER, null),
      ].map((e) => ({
        ...e,
        components: { ...e.components, Settler: { ...(e.components.Settler as object), tribe: 1 } },
      })),
    );
    const settlers = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((ref) => drawn(ref, 900 + ref * 30, 1000));

    expect(jobMatesIn(settlers, 1, AREA, snapshot, withHeroes)).toEqual([1, 2]);
    expect(jobMatesIn(settlers, 3, AREA, snapshot, withHeroes)).toEqual([3, 6]);
    expect(jobMatesIn(settlers, 4, AREA, snapshot, withHeroes)).toEqual([4, 8]);
    expect(jobMatesIn(settlers, 7, AREA, snapshot, withHeroes)).toEqual([7]);
    expect(jobMatesIn(settlers, 9, AREA, snapshot, withHeroes)).toEqual([9]);
  });

  it('matches vehicles by type without gathering settlers or unknown entities', () => {
    const snapshot = snapshotOf([
      { id: 1, components: { Vehicle: { vehicleType: 5 } } },
      { id: 2, components: { Vehicle: { vehicleType: 5 } } },
      { id: 3, components: { Vehicle: { vehicleType: 1 } } },
      settler(4, JOB_ARCHER, null),
      { id: 5, components: {} },
      { id: 6, components: {} },
    ]);
    const units = [1, 2, 3, 4, 5, 6].map((ref) => ({
      ...drawn(ref, 1000, 1000),
      kind: ref <= 3 ? ('vehicle' as const) : ('settler' as const),
    }));
    expect(jobMatesIn(units, 1, AREA, snapshot, content)).toEqual([1, 2]);
    expect(jobMatesIn(units, 3, AREA, snapshot, content)).toEqual([3]);
    expect(jobMatesIn(units, 5, AREA, snapshot, content)).toBeNull();
  });

  it('keeps jobs apart when their weapon family is absent and respects tribe-scoped data', () => {
    const snapshot = snapshotOf(
      [JOB_ARCHER, JOB_ARCHER_LONG, JOB_SOLDIER_SWORD].map((job, i) => ({
        id: i + 1,
        components: { Settler: { jobType: job, tribe: 2 } },
      })),
    );
    const units = [1, 2, 3].map((ref) => drawn(ref, 1000, 1000));
    const weapons = content.weapons.filter((w) => w.tribeType === 1);
    expect(jobMatesIn(units, 1, AREA, snapshot, { ...content, weapons })).toEqual([1]);
    const archer = weapons.find((w) => w.jobType === JOB_ARCHER);
    const longbow = weapons.find((w) => w.jobType === JOB_ARCHER_LONG);
    if (archer === undefined || longbow === undefined) throw new Error('missing bow fixtures');
    const scoped = {
      ...content,
      weapons: [
        ...weapons,
        { ...archer, tribeType: 2, mainType: 12 },
        { ...longbow, tribeType: 2, mainType: 13 },
      ],
    };
    expect(jobMatesIn(units, 1, AREA, snapshot, scoped)).toEqual([1]);
  });

  it('answers null for a click that did not land on a drawn settler', () => {
    const snapshot = snapshotOf([settler(1, JOB_BUILDER, null), settler(2, JOB_BUILDER, null)]);
    // 2 is selected but not drawn, like a settler picked through its house's door sign.
    expect(jobMatesIn([drawn(1, 1000, 1000)], 2, AREA, snapshot, content)).toBeNull();
  });
});
