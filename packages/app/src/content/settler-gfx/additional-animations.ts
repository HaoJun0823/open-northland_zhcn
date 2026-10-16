import { type FrameListAnim, type SettlerStateBinding, subClipKey } from '@open-northland/render/data';
import {
  ATTACK_ATOMIC,
  CHEER_ATOMIC,
  EAT_ATOMIC,
  EAT_CANDY_ATOMIC,
  SLEEP_ATOMIC,
} from '../../catalog/atomics.js';
import { JOB_DRUID } from '../../catalog/jobs.js';
import type { TribeClip } from '../ir/joins.js';
import type { BobSeqRow } from '../ir/rows.js';
import type { CharacterGfx } from './bindings-character.js';
import type { CharacterSpec } from './character-specs.js';
import { playableLists } from './frame-program.js';
import { eightDirAnim } from './seq-anim.js';

/** A trailing take number: `_attack2` and `_Attack_2` are second takes of `_attack` and `_Attack`. */
const TAKE_NUMBER = /_?\d+$/;

const BOW_PREFIXES: Readonly<Record<string, string>> = {
  human_man_Warrior_Shortbow_walk: 'human_man_Warrior_Shortbow',
  human_man_Warrior_Longbow_walk: 'human_man_Warrior_Longbow',
};

/** Unbound artwork must have matching heads; keep the existing clips on incomplete tribe sheets. */
function hasOwnHeads(row: BobSeqRow, gfx: CharacterGfx): boolean {
  return (gfx.headAtlases ?? []).every((atlas) => {
    for (let offset = 0; offset < row.length; offset++) {
      const frame = atlas.frames.get(row.start + offset);
      if (frame === undefined || frame.width === 0 || frame.height === 0) return false;
    }
    return true;
  });
}

function authoredClip(
  name: string,
  actions: readonly number[],
  sequences: ReadonlyMap<string, BobSeqRow>,
  gfx: CharacterGfx,
): FrameListAnim | undefined {
  const row = sequences.get(name);
  if (row === undefined || !hasOwnHeads(row, gfx)) return undefined;
  for (const action of actions) {
    const program = gfx.programsByAction?.get(action)?.get(name) ?? gfx.basePrograms?.get(action)?.get(name);
    const lists = playableLists(program, row, gfx.bodyAtlas);
    if (lists !== undefined) return { start: row.start, frameLists: lists };
  }
  return undefined;
}

/**
 * The swings one strike rolls from. Original behavior: the attack records of the tribe's nearest job, one
 * picked at random per strike. Approximations: the base tribe's records join where they name the same
 * bound swing, as the specs transcribe the viking clips, so the frankish and byzantine bare hands roll the
 * viking punches; a strip the body draws whose name differs from one of them only by a take number joins,
 * laid out by any tribe's record for it; every take is fitted whole into the one-hit atomic so combat
 * timing stays the bound swing's.
 */
function attackChoices(
  attackSeq: string | undefined,
  sequences: ReadonlyMap<string, BobSeqRow>,
  gfx: CharacterGfx,
): readonly FrameListAnim[] {
  if (attackSeq === undefined) return [];
  const naming = (set: readonly TribeClip[] = []) =>
    set.some((record) => record.seq === attackSeq) ? set : [];
  const own = naming(gfx.tribeSeqs?.attacks);
  const base = naming(gfx.baseAttacks);
  const names = [attackSeq];
  for (const { seq } of [...own, ...base]) if (!names.includes(seq)) names.push(seq);
  const stems = new Set(names.map((name) => name.replace(TAKE_NUMBER, '')));
  for (const name of sequences.keys()) {
    if (!names.includes(name) && stems.has(name.replace(TAKE_NUMBER, ''))) names.push(name);
  }
  return names.flatMap((name) => {
    const row = sequences.get(name);
    if (row === undefined || !hasOwnHeads(row, gfx)) return [];
    // This tribe's own frame lists first, so a take never swings another tribe's motion where it has its own.
    const program =
      own.find((record) => record.seq === name)?.program ??
      gfx.programsByAction?.get(ATTACK_ATOMIC)?.get(name) ??
      base.find((record) => record.seq === name)?.program ??
      gfx.basePrograms?.get(ATTACK_ATOMIC)?.get(name) ??
      gfx.attackPrograms?.get(name);
    const lists = playableLists(program, row, gfx.bodyAtlas);
    return lists === undefined ? [] : [{ start: row.start, frameLists: lists, spansAtomic: true }];
  });
}

/** The unbound shortbow strips retain the bow through meals and naps. Playback is an approximation:
 *  the meal reverses to its rest pose; the nap lies down, holds a breathing pose, then gets up once. */
function shortbowNeeds(
  sequences: ReadonlyMap<string, BobSeqRow>,
): NonNullable<SettlerStateBinding['byAtomic']> {
  const out: Record<number, FrameListAnim> = {};
  const eat = sequences.get('human_man_Warrior_Shortbow_eat');
  if (eat?.length === 18) {
    const forward = Array.from({ length: eat.length }, (_, i) => i);
    const meal = {
      start: eat.start,
      frameLists: [[...forward, ...forward.slice(1, -1).reverse()]],
      loop: true,
    };
    out[EAT_ATOMIC] = meal;
    out[EAT_CANDY_ATOMIC] = meal;
  }
  const sleep = sequences.get('human_man_Warrior_Shortbow_sleep');
  if (sleep?.length === 21) {
    const lieDown = Array.from({ length: sleep.length }, (_, i) => i);
    const rest = Array.from({ length: 240 }, (_, i) => 19 + (Math.floor(i / 12) % 2));
    out[SLEEP_ATOMIC] = {
      start: sleep.start,
      frameLists: [[...lieDown, ...rest, ...lieDown.slice(0, -1).reverse()]],
      spansAtomic: true,
    };
  }
  return out;
}

/** Additional unbound gestures, scoped to the look that actually performs them. */
function workAndBabyGestures(
  binding: SettlerStateBinding,
  spec: CharacterSpec,
  sequences: ReadonlyMap<string, BobSeqRow>,
  gfx: CharacterGfx,
): SettlerStateBinding {
  if (spec.gfxJobs[0] === JOB_DRUID) {
    const work = sequences.get('human_man_Druid_work');
    if (work?.length === 16 && hasOwnHeads(work, gfx)) {
      // The druid's production programs call action 4/subId 0 beside the cauldron. Approximation:
      // play the unbound work strip once over that window instead of the ordinary wait gesture.
      return {
        ...binding,
        bySubClip: {
          ...binding.bySubClip,
          [subClipKey(4, 0)]: {
            start: work.start,
            frameLists: [Array.from({ length: work.length }, (_, i) => i)],
          },
        },
      };
    }
  }
  // Babies include their heads in the body artwork; their separate head sheet is blank.
  if (spec.waitSeq === 'human_child_baby_generic_wait') {
    const wait = sequences.get('human_child_baby_generic_wait_1');
    if (wait?.length === 39) {
      // Three visually matched 13-frame poses: left, right and front. Unbound timing is approximate;
      // holding each frame for three ticks keeps the occasional gesture readable.
      const groups = [0, 0, 0, 1, 1, 1, 2, 2];
      return {
        ...binding,
        idleFidgetGapTicks: 600,
        idleFidgets: [
          {
            start: wait.start,
            frameLists: groups.map((group) =>
              Array.from({ length: 39 }, (_, i) => group * 13 + Math.floor(i / 3)),
            ),
          },
        ],
      };
    }
  }
  return binding;
}

export function withAdditionalAnimations(
  attackSeq: string | undefined,
  binding: SettlerStateBinding,
  spec: CharacterSpec,
  sequences: ReadonlyMap<string, BobSeqRow>,
  gfx: CharacterGfx,
): SettlerStateBinding {
  binding = workAndBabyGestures(binding, spec, sequences, gfx);
  const choices = attackChoices(attackSeq, sequences, gfx);
  const attacks = choices.length > 1 ? { byAtomicChoices: { [ATTACK_ATOMIC]: choices } } : {};
  const prefix = spec.walkSeq === undefined ? undefined : BOW_PREFIXES[spec.walkSeq];
  if (prefix === undefined) {
    const jump = sequences.get('human_man_generic_happy_jump');
    const cheer =
      spec.attack === 'human_man_Civilian_Fight_punch' && jump !== undefined && hasOwnHeads(jump, gfx)
        ? {
            [CHEER_ATOMIC]: {
              start: jump.start,
              // Unbound strip: play the jump once over the civilian celebration's authored duration.
              frameLists: [Array.from({ length: jump.length }, (_, i) => i)],
              spansAtomic: true,
            },
          }
        : undefined;
    return {
      ...binding,
      ...attacks,
      ...(cheer === undefined ? {} : { byAtomic: { ...binding.byAtomic, ...cheer } }),
    };
  }

  sequences = new Map([...sequences].filter(([, row]) => hasOwnHeads(row, gfx)));

  // The Viking wave is an idle action (4); other tribes bind the same artwork to cheer (17).
  const wave = authoredClip(`${prefix}_happy`, [4, 17], sequences, gfx);
  const moving = eightDirAnim(sequences, `${prefix}_walk_agressive`, gfx.walkLists);
  const stance = sequences.get(`${prefix}_wait_agressive`);
  // The bow stance has no atomic record. Its turning gesture shares the spear stance's first 28 frames;
  // borrow that authored wait program by analogy, not a division into directional blocks.
  const spearName = 'human_man_Warrior_spear_wait_agressive';
  const spearProgram =
    gfx.programsByAction?.get(6)?.get(spearName) ?? gfx.basePrograms?.get(6)?.get(spearName);
  const stanceLists = stance === undefined ? undefined : playableLists(spearProgram, stance, gfx.bodyAtlas);
  const idle =
    stance?.length === 28 &&
    stanceLists !== undefined &&
    stanceLists.every((list) => list.every((offset) => offset >= 0 && offset < stance.length))
      ? { start: stance.start, frameLists: stanceLists, loop: true }
      : undefined;
  const needs = prefix === 'human_man_Warrior_Shortbow' ? shortbowNeeds(sequences) : {};
  return {
    ...binding,
    ...attacks,
    byAtomic: { ...binding.byAtomic, ...needs },
    ...(wave !== undefined
      ? {
          idleFidgets: [wave],
          // Approximation: a wave after roughly 50 seconds of uninterrupted rest, between complete waits.
          idleFidgetGapTicks: 600,
        }
      : {}),
    ...(moving !== undefined || idle !== undefined
      ? {
          engaged: {
            ...binding.engaged,
            ...(moving !== undefined ? { moving } : {}),
            ...(idle !== undefined ? { idle } : {}),
          },
        }
      : {}),
  };
}
