import { Simulation } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_CHILD_FEMALE,
  JOB_COLLECTOR,
  JOB_HERO_SWORD,
  JOB_SCOUT,
  JOB_SOLDIER,
  JOB_WOMAN,
} from '../../../../src/catalog/jobs.js';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import {
  buildUnitPanelModel,
  type SettlerWorkStatus,
} from '../../../../src/hud/details-panel/model/index.js';
import { statusText, statusTone } from '../../../../src/hud/dom/settler-panel/portrait.js';
import { messages } from '../../../../src/i18n/index.js';
import { ctxOf, snapshotOf } from '../../../support/sandbox.js';

function fixture() {
  const sim = new Simulation({ seed: 7, content: sandboxContent() });
  sim.enqueueSetup({ kind: 'spawnSettler', jobType: JOB_SCOUT, x: 4, y: 4, tribe: 1, owner: 0 });
  sim.step();
  const snapshot = sim.snapshot();
  const scout = snapshot.entities.find(
    (e) => (e.components.Settler as { jobType?: number } | undefined)?.jobType === JOB_SCOUT,
  );
  if (scout === undefined) throw new Error('missing scout');
  const scoutId = sim.world.canonicalEntities().find((id) => id === scout.id);
  if (scoutId === undefined) throw new Error('missing scout entity');
  const ctx = ctxOf(sim);
  const soldier = ctx.jobs.find((job) => job.typeId === JOB_SOLDIER);
  if (soldier === undefined) throw new Error('missing soldier job');
  // The sandbox omits heroes; supply the same semantic job row a mission catalog provides.
  const jobs = [...ctx.jobs, { ...soldier, id: 'hero_sword_bjarni', typeId: JOB_HERO_SWORD }];
  const model = (components: Record<string, unknown> = {}, status = sim.workStatus(scoutId)) => {
    const result = buildUnitPanelModel(
      snapshotOf([{ ...scout, components: { ...scout.components, ...components } }]),
      new Set([scout.id]),
      { ...ctx, jobs, workStatus: () => status },
    );
    if (result.kind !== 'settler') throw new Error('not a settler model');
    return result;
  };
  return { sim, scoutId, model };
}

describe('idle scout status', () => {
  it('diagnoses the real scout as awaiting orders and renders a neutral status strip', () => {
    const { sim, scoutId, model } = fixture();
    const before = sim.hashState();
    expect(sim.workStatus(scoutId)).toEqual({ kind: 'awaitingOrders' });
    expect(sim.hashState()).toBe(before);
    const status = model().status;
    expect(status).toMatchObject({
      state: 'idle',
      trouble: false,
      detail: messages().hud.settlerPanel.idleReasons.awaitingOrders,
    });
    expect(statusTone(status)).toBe('neutral');
    expect(statusText(status)).toBe(
      `${messages().hud.statuses.idle} · ${messages().hud.settlerPanel.idleReasons.awaitingOrders}`,
    );
  });

  it('preserves lost, need and active order status ahead of the normal wait', () => {
    const { model } = fixture();
    const lost = model({ LostWay: { cutOff: true, since: 0, goal: 8 } }).status;
    expect(lost).toMatchObject({
      state: 'lost',
      trouble: true,
      detail: messages().hud.settlerPanel.lostDetail,
    });
    expect(statusTone(lost)).toBe('trouble');
    expect(model({ CurrentAtomic: { effect: { kind: 'eat' } } }).status).toMatchObject({
      state: 'eating',
      detail: null,
    });
    expect(model({ PlayerOrder: {} }).status).toMatchObject({ state: 'ordered', detail: null });
    const blocked = model({}, { kind: 'workplaceOutOfReach' }).status;
    expect(blocked.trouble).toBe(true);
    expect(blocked.detail).toBe(messages().hud.settlerPanel.idleReasons.workplaceOutOfReach);
  });

  it('keeps unexplained economy work amber instead of calling it a normal wait', () => {
    const { model } = fixture();
    const unknown: SettlerWorkStatus = { kind: 'unknown', reason: 'gatherSearch' };
    const status = model({ Settler: { tribe: 1, jobType: JOB_COLLECTOR } }, unknown).status;
    expect(status.detail).toBe(messages().hud.settlerPanel.idleReasons.unknown);
    expect(statusTone(status)).toBe('trouble');
  });

  it.each([
    ['woman', { Settler: { tribe: 1, jobType: JOB_WOMAN }, Female: {} }],
    ['child', { Settler: { tribe: 1, jobType: JOB_CHILD_FEMALE }, Female: {}, Age: {} }],
    ['soldier', { Settler: { tribe: 1, jobType: JOB_SOLDIER } }],
    ['hero', { Settler: { tribe: 1, jobType: JOB_HERO_SWORD } }],
  ] as const)(
    'omits an unsupported workplace diagnosis for an idle %s without hiding actual problems',
    (role, components) => {
      const { model } = fixture();
      const unsupported: SettlerWorkStatus = { kind: 'unknown', reason: 'unsupportedWorkplace' };
      const normal = model(components, unsupported);
      expect(normal.role).toBe(role);
      expect(normal.status).toMatchObject({ state: 'idle', detail: null, trouble: false });
      expect(statusText(normal.status)).toBe(normal.status.label);
      const lost = model({ ...components, LostWay: { cutOff: true, since: 0, goal: 8 } }, unsupported).status;
      expect(lost).toMatchObject({
        state: 'lost',
        trouble: true,
        detail: messages().hud.settlerPanel.lostDetail,
      });
      const blocker = model(components, { kind: 'workplaceOutOfReach' }).status;
      expect(blocker.detail).toBe(messages().hud.settlerPanel.idleReasons.workplaceOutOfReach);
    },
  );
});
