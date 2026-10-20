import type { ConvertedMap } from '@open-northland/map-import';

/** `map.cif` campaign ids (`mapcampaignid`) of the campaigns authored before Die Saga gave the Byzantine
 *  wooden spearman its dragon form. Project choice: the dragon's graphics and the Saga campaign entered
 *  the data together, so these maps place and script that class as men. */
const CAMPAIGN_CULTURES_2 = 1;
const CAMPAIGN_NORTHLAND = 2;
const CAMPAIGN_EIGHTH_WONDER = 3;
const CAMPAIGN_TUTORIALS = 100;
const CAMPAIGNS_BEFORE_CREATURE_FORMS: ReadonlySet<number> = new Set([
  CAMPAIGN_CULTURES_2,
  CAMPAIGN_NORTHLAND,
  CAMPAIGN_EIGHTH_WONDER,
  CAMPAIGN_TUTORIALS,
]);

/** Stamp a map of a campaign authored before the creature forms with `authoredForm: 'human'`; a map without
 *  a script, or of any later campaign or none, keeps the native form. */
export function withAuthoredForm<T extends Pick<ConvertedMap, 'meta' | 'script'>>(map: T): T {
  const campaignId = map.meta.campaign?.campaignId;
  if (
    map.script === undefined ||
    campaignId === undefined ||
    !CAMPAIGNS_BEFORE_CREATURE_FORMS.has(campaignId)
  )
    return map;
  return { ...map, script: { ...map.script, authoredForm: 'human' } };
}
