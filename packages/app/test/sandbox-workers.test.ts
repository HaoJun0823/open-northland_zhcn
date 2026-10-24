import { describe, expect, it } from 'vitest';
import { JOB_ARCHER, JOB_ARCHER_LONG, JOB_CARRIER, JOB_HUNTER } from '../src/catalog/jobs.js';
import {
  BUILDING_JOINERY,
  BUILDING_WATCHTOWER,
  WORKER_SLOT_JOB_BASE,
} from '../src/game/sandbox/ids/index.js';
import {
  assignmentPriority,
  assignmentPriorityFor,
  sandboxContent,
  workerRoleOf,
} from '../src/game/sandbox/index.js';
import { professionLabel } from '../src/i18n/index.js';

/**
 * The sandbox buildings must carry their worker + carrier capacity (extracted from ir.json's
 * `logicworker`), or `assignWorker` has no open slot to bind to and every right-click no-ops. Homes
 * employ nobody. Every worker-slot jobType must resolve as a content job (the cross-reference gate).
 */
describe('sandbox building worker slots', () => {
  const content = sandboxContent();
  const byType = new Map(content.buildings.map((b) => [b.typeId, b]));
  const jobIds = new Set(content.jobs.map((j) => j.typeId));

  it('resolves every worker-slot jobType as a content job (no dangling cross-reference)', () => {
    for (const b of content.buildings) {
      for (const w of b.workers) expect(jobIds.has(w.jobType)).toBe(true);
    }
  });

  it('rebases every extracted slot job clear of the native sandbox bands - the id-collision guard', () => {
    // The original `logicworker` ids overlap the sandbox's own bands (22 = mud gatherer, 24 = carrier), so
    // before the rebase an HQ slot silently read as a native gatherer. Every extracted slot must now be one
    // of the rebase-exempt trades the sandbox band DEFINES - the carrier, the hunter, and the two tower
    // archers, each of which the sim classifies by its id slug - or a rebased id (>= the base), never any
    // other raw native-band id.
    const exempt = new Set([JOB_CARRIER, JOB_HUNTER, JOB_ARCHER, JOB_ARCHER_LONG]);
    for (const b of content.buildings) {
      if (b.typeId === BUILDING_JOINERY) continue; // its demo worker is a DELIBERATE native gatherer (below)
      for (const w of b.workers)
        expect(exempt.has(w.jobType) || w.jobType >= WORKER_SLOT_JOB_BASE).toBe(true);
    }
    // The HQ dispatches gatherers (collector/fisher/hunter) and carriers - 9 gatherers + 3 carriers, no
    // in-workshop craftsman. The player can only hand-assign its carriers (a gatherer is never a PPM target).
    const hq = byType.get(1)?.workers ?? [];
    const headcount = (role: string): number =>
      hq.filter((w) => workerRoleOf(w.jobType) === role).reduce((sum, w) => sum + w.count, 0);
    expect(headcount('carrier')).toBe(3);
    expect(headcount('gatherer')).toBe(9);
    expect(headcount('craftsman')).toBe(0);
  });

  it('employs the hunter trade ITSELF on a building hunter slot (rebase-exempt), so an HQ hunter hunts', () => {
    // A rebased `worker_1015` id would strip the `hunter` slug that `jobRoleOfId` keys on: no shooting,
    // no workplace hunting ground, no signpost exemption - a dead slot. The slot must BE job 15.
    const hq = byType.get(1)?.workers ?? [];
    expect(hq.some((w) => w.jobType === JOB_HUNTER)).toBe(true);
    expect(content.jobs.find((j) => j.typeId === JOB_HUNTER)?.id).toBe('hunter');
  });

  it('names each extracted craftsman by its real trade, from the SAME i18n label the picker uses', () => {
    const firstCraftName = (typeId: number): string | undefined => {
      const slot = byType.get(typeId)?.workers.find((w) => workerRoleOf(w.jobType) === 'craftsman');
      return content.jobs.find((j) => j.typeId === slot?.jobType)?.name;
    };
    expect(firstCraftName(31)).toBe('Kowal'); // smithy → smith (original job 13)
    expect(firstCraftName(35)).toBe('Druid'); // druid hut → druid (original job 30)
    // Drift guard: the slot label must be the SAME word the profession picker shows (they were once
    // transcribed twice and diverged - a joiner had one name in the slot and another in the picker).
    expect(firstCraftName(31)).toBe(professionLabel('smith'));
    expect(firstCraftName(24)).toBe(professionLabel('joiner')); // work_joinery_01 → joiner (original job 9)
  });

  it('offers the Druid first on a right-click of the druid hut, and never the collector-gatherer', () => {
    // The reported bug: right-clicking the druid hut made a collector first. The collector is a
    // gatherer role, so it must be excluded from the priority, and the Druid craft leads it.
    const priority = assignmentPriority(byType.get(35)?.workers);
    expect(priority.every((jobType) => workerRoleOf(jobType) !== 'gatherer')).toBe(true);
    expect(content.jobs.find((j) => j.typeId === priority[0])?.name).toBe('Druid');
  });

  it('offers a watchtower’s archer posts to that archer alone, and its hauler slot to everyone else', () => {
    const slots = byType.get(BUILDING_WATCHTOWER)?.workers;
    // A bow soldier gets his own post and NOTHING else: the tower also employs haulers, and falling
    // through would quietly re-trade him into one.
    expect(assignmentPriorityFor(JOB_ARCHER, slots)).toEqual([JOB_ARCHER]);
    expect(assignmentPriorityFor(JOB_ARCHER_LONG, slots)).toEqual([JOB_ARCHER_LONG]);
    // Everyone else is never offered a post - only the hauler slot.
    expect(assignmentPriority(slots)).toEqual([JOB_CARRIER]);
    expect(assignmentPriorityFor(JOB_CARRIER, slots)).toEqual([JOB_CARRIER]);
  });
});
