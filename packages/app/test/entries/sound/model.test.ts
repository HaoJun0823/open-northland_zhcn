import { attackAlertShot, buildSoundIndex, defaultBindings, type SoundIndex } from '@open-northland/audio';
import { emptySoundBank, type SoundBank } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { buildSoundGalleryModel } from '../../../src/entries/sound/model.js';

/**
 * The `?sounds` gallery's PURE model: the auditable join of the decoded bank, the sound index the game
 * plays from and the event bindings. This is the half a human can't self-judge made checkable - that a
 * life event reaches its jingle, that each row plays the way the game plays it, and that the data's
 * silent placeholder slots never reach the list - without a browser or an AudioContext.
 */

/** A tribe the test names only by number, shouting from another nation's group. */
const EGYPT = 7;

const bank: SoundBank = {
  staticGroups: [
    {
      name: 'Woodcutter Axe',
      logicSoundType: 9,
      sfx: [f('static/axe01.wav'), f('static/dummy.wav'), f('static/axe02.wav'), f('static/axe03.wav')],
    },
    { name: 'Silent Slot', logicSoundType: 12, sfx: [f('static/dummy.wav')] },
    { name: 'Hammer Wood', sfx: [f('static/hammer01.wav'), f('static/hammer02.wav')] },
    { name: 'Carpenter Saw', sfx: [f('static/carpenter_saw01.wav')] },
    { name: 'Generic Viking Male', sfx: [f('generic/m1.wav')] },
    { name: 'Man Get Hit', sfx: [f('static/hit m 01.wav')] },
    { name: 'Viking male ok 01', sfx: [f('humantalk/m1ok01.wav')] },
    { name: 'Viking male no 01', sfx: [f('humantalk/m1no01.wav')] },
    { name: 'Generic Viking Children', sfx: [f('generic/c1.wav')] },
    { name: 'Bear Sounds', sfx: [f('generic/bear1.wav')] },
    {
      name: 'Attack Alert Viking Settlement',
      sfx: [f('alerts/viking_base1.wav'), f('alerts/viking_base2.wav')],
    },
    { name: 'Attack Alert Viking Field', sfx: [f('alerts/viking_units1.wav')] },
    { name: 'Attack Alert Saracen Settlement', sfx: [f('alerts/saracen_base1.wav')] },
  ],
  ambient: [
    {
      name: 'Meadow Green',
      patternGroups: ['meadow green'],
      landscapeGroups: [],
      sfx: [f('ambient/meadow1.wav')],
    },
  ],
  jingles: [
    { name: 'House Built', musicType: 26, sfx: [f('jingles/jingles_housebuilt.wav')] },
    { name: 'Birth', musicType: 23, sfx: [f('jingles/jingles_birth.wav')] },
    { name: 'Death', musicType: 25, sfx: [f('jingles/jingles_death.wav')] },
  ],
  humanVoices: [
    { tribe: 1, voiceClass: 'child', generic: 'Generic Viking Children', respondOk: [], respondNo: [] },
    {
      tribe: 1,
      voiceClass: 'male',
      scream: 'Man Get Hit',
      generic: 'Generic Viking Male',
      respondOk: ['Viking male ok 01'],
      respondNo: ['Viking male no 01'],
    },
    { tribe: 2, voiceClass: 'male', scream: 'Man Get Hit', respondOk: [], respondNo: [] },
  ],
  animalCalls: [{ tribe: 8, minCount: 1, probability: 10, group: 'Bear Sounds' }],
  // Out of order, a tribe borrowing another nation's group, and a row whose group the bank lacks.
  attackAlerts: [
    { tribe: EGYPT, front: 'base', group: 'Attack Alert Saracen Settlement' },
    { tribe: 1, front: 'units', group: 'Attack Alert Viking Field' },
    { tribe: 1, front: 'base', group: 'Attack Alert Viking Settlement' },
    { tribe: EGYPT, front: 'units', group: 'Attack Alert Saracen Field' },
  ],
};

/** A landscape typeId whose ground the test index loops the meadow bed over. */
const MEADOW_GROUND = 3;
const BIRDS_RECORDS = [40, 41];

const built = buildSoundIndex(bank, [], []);
const index: SoundIndex = {
  ...built,
  ambientByTerrainType: new Map([[MEADOW_GROUND, ['Meadow Green']]]),
  landscapeAmbienceByRecord: new Map(
    BIRDS_RECORDS.map((record) => [
      record,
      {
        name: 'Birds',
        weight: 20,
        pools: [
          { files: ['landscape/bird1.wav', 'landscape/bird2.wav'], weight: 10, chance: 2 },
          { files: ['landscape/owl.wav'], weight: 10, chance: 1 },
        ],
      },
    ]),
  ),
};

/** The tribe names a real IR supplies: vikings and bears named, the franks left to their number. */
const tribeLabel = (tribe: number): string | undefined =>
  tribe === 1 ? 'Wikingowie' : tribe === 8 ? 'niedźwiedź' : undefined;

/** A one-clip SoundSfx (params default to empty - the gallery reads only the file). */
function f(file: string): { file: string; params: number[] } {
  return { file, params: [] };
}

describe('buildSoundGalleryModel', () => {
  const model = buildSoundGalleryModel(bank, index, defaultBindings(), tribeLabel);

  it('lists every cue group with the logicSoundType id an animation names it by, minus the silent slots', () => {
    // A settler's work sounds are not bound here - the animation names them - so the gallery auditions
    // the groups themselves, keyed by the id an `event <at> 34 <id>` row carries.
    const axe = model.cues.find((c) => c.group === 'Woodcutter Axe');
    expect(axe?.soundType).toBe(9);
    expect(axe?.clips).toEqual(['static/axe01.wav', 'static/axe02.wav', 'static/axe03.wav']);
    // The index's own array, so a play shares the game's pool, volume and no-repeat memory.
    expect(axe?.clips).toBe(index.groupsByName.get('woodcutter axe'));
    expect(axe?.play).toEqual({ kind: 'pool', role: { kind: 'world', layer: 'detail' } });
    // A group of placeholders only sounds nothing in the game, and a group without an id no cue reaches.
    expect(model.cues.map((c) => c.group)).toEqual(['Woodcutter Axe']);
  });

  it('lists each tribe`s voices by class, grown first, each role in the lane the game plays it in', () => {
    expect(model.voices.map((v) => v.label)).toEqual([
      'Wikingowie · Mężczyźni',
      'Wikingowie · Dzieci',
      'Plemię 2 · Mężczyźni',
    ]);
    const man = model.voices[0]?.groups ?? [];
    expect(man.map((g) => g.group)).toEqual([
      'Krzyk: Man Get Hit',
      'Gwar: Generic Viking Male',
      'Tak: Viking male ok 01',
      'Nie: Viking male no 01',
    ]);
    expect(man.map((g) => (g.play.kind === 'pool' ? g.play.role.kind : g.play.kind))).toEqual([
      'scream',
      'voice',
      'answer',
      'answer',
    ]);
    expect(model.voices[1]?.groups.map((g) => g.group)).toEqual(['Gwar: Generic Viking Children']);
  });

  it('lists the animal calls by species, as voices', () => {
    expect(model.animalCalls).toEqual([
      {
        group: 'niedźwiedź: Bear Sounds',
        clips: ['generic/bear1.wav'],
        play: { kind: 'pool', role: { kind: 'voice' } },
      },
    ]);
  });

  it('lists each tribe`s attack alert per front, playing the shot the alert fires', () => {
    expect(model.attackAlerts.map((row) => [row.group, row.clips])).toEqual([
      [
        'Wikingowie · osada: Attack Alert Viking Settlement',
        ['alerts/viking_base1.wav', 'alerts/viking_base2.wav'],
      ],
      ['Wikingowie · ludzie w polu: Attack Alert Viking Field', ['alerts/viking_units1.wav']],
      ['Plemię 7 · osada: Attack Alert Saracen Settlement', ['alerts/saracen_base1.wav']],
      ['Plemię 7 · ludzie w polu: Attack Alert Saracen Field', []],
    ]);
    const [vikingBase] = model.attackAlerts;
    expect(vikingBase?.play).toEqual({ kind: 'cue', shot: attackAlertShot(index, 1, 'base') });
    expect(vikingBase?.play.kind === 'cue' && vikingBase.play.shot.lane).toEqual({
      kind: 'alert',
      alert: 'baseAttacked',
    });
  });

  it('lists every jingle and every bed, marking a bed no ground loops in play', () => {
    expect(model.jingles.map((j) => j.group)).toEqual(['House Built', 'Birth', 'Death']);
    expect(model.ambient).toEqual([
      { group: 'Meadow Green', clips: ['ambient/meadow1.wav'], play: { kind: 'bed', looped: true } },
    ]);
    const unlooped = buildSoundGalleryModel(bank, built, defaultBindings(), tribeLabel);
    expect(unlooped.ambient[0]?.play).toEqual({ kind: 'bed', looped: false });
    // A decoded map's ground pattern loops a bed no typeId's representative reaches.
    const byGround = buildSoundGalleryModel(
      bank,
      { ...built, ambientByGroundPattern: new Map([['meadow 01', ['Meadow Green']]]) },
      defaultBindings(),
      tribeLabel,
    );
    expect(byGround.ambient[0]?.play).toEqual({ kind: 'bed', looped: true });
  });

  it('lists each object ambience pool once, however many records share it', () => {
    expect(model.objectAmbience.map((row) => [row.group, row.clips.length])).toEqual([
      ['Birds · 1', 2],
      ['Birds · 2', 1],
    ]);
  });

  it('lists one named row per bound event, so no binding hides from the listener', () => {
    // The rows come from the bindings, not a hand list: every bound kind needs a catalog label, and a
    // kind nothing binds (the chopping swing lives in the animation cue) gets no row.
    const bound = Object.keys(defaultBindings().byEvent);
    expect(model.actions).toHaveLength(bound.length);
    expect(model.actions.map((a) => a.label)).not.toContain('Rąbanie drzewa');
    expect(model.actions.find((a) => a.label === 'Odprawa')).toMatchObject({
      label: 'Odprawa',
      trigger: 'gdy skrypt mapy otwiera odprawę',
      group: 'briefing',
      kind: 'cue',
      screenGated: false,
      clips: ['gui/briefing_popup.wav'],
    });
    // A jingle the bank lacks still shows its MusicType, so the gap is visible rather than silent.
    expect(model.actions.find((a) => a.label === 'Ślub')).toMatchObject({ group: 'MusicType 22', clips: [] });
  });

  it('shows a group missing from the bank with an empty clip list, not a crash', () => {
    const bare: SoundBank = { ...emptySoundBank(), humanVoices: bank.humanVoices };
    const m = buildSoundGalleryModel(bare, buildSoundIndex(bare, [], []), defaultBindings());
    // Voice rows still listed from their table, with no group to play since the bank has none.
    expect(m.voices).toHaveLength(3);
    expect(m.voices.flatMap((v) => v.groups)).toEqual([]);
    // A spatial action whose group is missing resolves to an empty clip list (still shown for auditing).
    expect(m.actions.find((a) => a.label === 'Ukończenie wehikułu')?.clips).toEqual([]);
    expect(m.cues).toEqual([]);
  });
});
