import {
  buildSpriteScene,
  resolveSettlerBobId,
  type SettlerStateBinding,
  subClipKey,
} from '@open-northland/render';
import { components } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_BABY_FEMALE, JOB_BABY_MALE, JOB_DRUID, JOB_FISHER } from '../../../src/catalog/jobs.js';
import { inHouseProgramLookup } from '../../../src/content/ir/joins.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { createSceneSim } from '../../../src/scenes/runtime.js';
import { everydayGesturesScene } from '../../../src/scenes/settlers/everyday-gestures.js';
import { characterTablesUnderTest, hasRealIr, loadContentUnderTest, rawIrUnderTest } from '../helpers.js';

/** The druid's brewing strip and the fisher's rod walk in the viking body's bob pool (`[bobseq]`). */
const BREWING_BOBS = { start: 661, end: 677 } as const;
const ROD_WALK_BOBS = { start: 959, end: 1055 } as const;
/** The baby body's gesture strip. */
const BABY_GESTURE_BOBS = { start: 146, end: 185 } as const;
/** The druid's brewing program action and the sub-clip its first step plays. */
const BREW_ACTION = 4;
const BREW_SUB_CLIP = 0;
const SCENE_TICKS = 900;

const inStrip = (bob: number, strip: { readonly start: number; readonly end: number }): boolean =>
  bob >= strip.start && bob < strip.end;

describe.runIf(hasRealIr())('everyday animation playback', () => {
  const table = characterTablesUnderTest([1])?.get(1);
  if (table === undefined) return;

  it('keeps every druid head and hat visible throughout brewing', () => {
    const look = table.byJob[JOB_DRUID];
    expect(look?.heads).toHaveLength(4);
    for (const head of look?.heads ?? []) {
      for (let bob = BREWING_BOBS.start; bob < BREWING_BOBS.end; bob++) {
        const frame = head.atlas.frames.get(bob);
        expect(frame?.width, `brewing head ${bob}`).toBeGreaterThan(0);
        expect(frame?.height, `brewing head ${bob}`).toBeGreaterThan(0);
      }
    }
  });

  it('reaches brewing, rod walking and baby gestures from ordinary simulation state', async () => {
    const { merge } = await loadContentUnderTest();
    const sim = createSceneSim(everydayGesturesScene, { content: merge.content });
    const lookup = inHouseProgramLookup(rawIrUnderTest() as ContentIr, sim.content.goods);
    const druid = table.byJob[JOB_DRUID]?.binding;
    expect(druid?.bySubClip?.[subClipKey(BREW_ACTION, BREW_SUB_CLIP)]).toMatchObject({
      start: BREWING_BOBS.start,
    });
    expect(table.byJob[JOB_FISHER]?.binding.moving).toMatchObject({ start: ROD_WALK_BOBS.start });
    const reached = new Set<string>();
    const brewingFrames = new Set<number>();
    for (let tick = 0; tick < SCENE_TICKS; tick++) {
      sim.step();
      const jobs = new Map<number, number | null>(
        [...sim.world.query(components.Settler)].map((e) => [
          e,
          sim.world.get(e, components.Settler).jobType,
        ]),
      );
      const scene = buildSpriteScene(sim.snapshot(), { inHousePrograms: lookup });
      for (const item of scene) {
        if (item.kind !== 'settler') continue;
        const job = jobs.get(item.ref);
        let binding: SettlerStateBinding | undefined;
        if (job === JOB_BABY_FEMALE || job === JOB_BABY_MALE) binding = table.youngByJob?.[job]?.binding;
        else if (job === JOB_DRUID || job === JOB_FISHER) binding = table.byJob[job]?.binding;
        if (binding === undefined) continue;
        const bob = resolveSettlerBobId(binding, item, sim.tick, sim.tick, tick);
        if (job === JOB_DRUID && item.craftClip !== undefined && inStrip(bob, BREWING_BOBS)) {
          reached.add('brewing');
          brewingFrames.add(bob);
        }
        if (job === JOB_FISHER && item.state === 'moving') {
          if (!item.carrying && inStrip(bob, ROD_WALK_BOBS)) reached.add('rod walk');
          if (item.carrying) {
            expect(inStrip(bob, ROD_WALK_BOBS)).toBe(false);
            reached.add('carrying catch');
          }
        }
        if ((job === JOB_BABY_FEMALE || job === JOB_BABY_MALE) && inStrip(bob, BABY_GESTURE_BOBS))
          reached.add('baby gesture');
      }
    }
    expect([...brewingFrames].sort((a, b) => a - b)).toEqual(
      Array.from({ length: BREWING_BOBS.end - BREWING_BOBS.start }, (_, i) => BREWING_BOBS.start + i),
    );
    expect(reached).toEqual(new Set(['brewing', 'rod walk', 'carrying catch', 'baby gesture']));
  });
});
