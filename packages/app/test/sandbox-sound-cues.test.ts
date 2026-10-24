import { describe, expect, it } from 'vitest';
import { grassTerrain } from '../src/catalog/buildings.js';
import { sandboxContent } from '../src/game/sandbox/index.js';

/**
 * The sandbox clips' transcribed `event <at> 34 <id>` cues. The sim sounds a settler's action off these
 * rows alone, so a clip missing them works in silence - and a clip the sandbox replays at its own tick
 * count needs its authored frame rescaled, or the sound drifts off the visible strike.
 */

const PLAY_SOUND_FX = 34;
const CHANGE_SOCIAL = 3;
/** `logicSoundType` ids from `soundfx.cif`: Hammer Wood, SocialTalk Male. */
const HAMMER_WOOD = 1;
const SOCIALTALK_MALE = 61;

const content = sandboxContent(grassTerrain(8, 8));

function clip(name: string): { length: number; cues: { at: number; value: number | undefined }[] } {
  const anim = content.atomicAnimations.find((a) => a.name === name);
  if (anim === undefined) throw new Error(`sandbox content has no clip ${name}`);
  return {
    length: anim.length,
    cues: anim.events.filter((e) => e.type === PLAY_SOUND_FX).map((e) => ({ at: e.at, value: e.value })),
  };
}

describe('sandbox authored sound cues', () => {
  it('keeps the builder’s knock on the strike frame at the swing’s halved cadence', () => {
    // `viking_builder_build_house` is `length 15`, `event 4 34 1`, replayed here at two ticks per frame.
    const build = clip('viking_builder_build_house');
    expect(build.length).toBe(30);
    expect(build.cues).toEqual([{ at: 8, value: HAMMER_WOOD }]);
  });

  it('gives the chat clips their voice cue alongside the company-bar pulses', () => {
    const talk = content.atomicAnimations.find((a) => a.name === 'viking_civilist_talk');
    expect(talk?.events.filter((e) => e.type === PLAY_SOUND_FX)).toEqual([
      { at: 0, type: PLAY_SOUND_FX, value: SOCIALTALK_MALE, extended: false },
    ]);
    // The channel-3 refill rows survive the merge - the voice cue is added beside them, not instead.
    expect(talk?.events.filter((e) => e.type === CHANGE_SOCIAL)).toHaveLength(5);
  });
});
