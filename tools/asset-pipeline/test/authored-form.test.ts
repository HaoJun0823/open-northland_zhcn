import { MapMeta, MapScript } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { withAuthoredForm } from '../src/stages/maps/authored-form.js';

const WONDER = 3;
const SAGA = 4;
const TUTORIALS = 100;

function converted(campaignId: number | undefined, script: MapScript | undefined) {
  const meta = MapMeta.parse({
    name: {},
    ...(campaignId === undefined ? {} : { campaign: { campaignId, missionId: 1 } }),
  });
  return { meta, ...(script === undefined ? {} : { script }) };
}

const SCRIPT = MapScript.parse({});

describe('withAuthoredForm', () => {
  it('stamps the human form on maps of the campaigns authored before the creature forms', () => {
    for (const campaignId of [WONDER, TUTORIALS])
      expect(withAuthoredForm(converted(campaignId, SCRIPT)).script?.authoredForm).toBe('human');
  });

  it('leaves later campaigns, free maps and maps without a script alone', () => {
    const saga = converted(SAGA, SCRIPT);
    expect(withAuthoredForm(saga)).toBe(saga);
    const free = converted(undefined, SCRIPT);
    expect(withAuthoredForm(free)).toBe(free);
    const scriptless = converted(WONDER, undefined);
    expect(withAuthoredForm(scriptless)).toBe(scriptless);
  });
});
