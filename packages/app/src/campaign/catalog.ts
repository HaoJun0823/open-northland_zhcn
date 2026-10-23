import { type Campaign, CampaignIndex } from '@open-northland/data';
import { fetchJsonOrNull } from '../content/net.js';
import { type ContentFetch, contentFetch } from '../content/url.js';
import { diag } from '../diag/index.js';

/** The campaigns in display order. A missing, drifted or wrong-version index reads as none installed. */
export async function loadCampaigns(fetchImpl: ContentFetch = contentFetch): Promise<readonly Campaign[]> {
  const value = await fetchJsonOrNull<unknown>('/campaigns-index.json', fetchImpl);
  if (value === null) return [];
  const parsed = CampaignIndex.safeParse(value);
  if (!parsed.success) {
    diag.warn('content', 'campaigns-index.json does not match its schema; no campaign is offered', {
      issues: parsed.error.issues.slice(0, 1),
    });
    return [];
  }
  return [...parsed.data.campaigns].sort((a, b) => a.order - b.order);
}

export function campaignForMap(campaigns: readonly Campaign[], mapId: string): Campaign | undefined {
  return campaigns.find((campaign) => campaign.maps.some((map) => map.id === mapId));
}
