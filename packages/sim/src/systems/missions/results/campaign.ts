import { requestCampaignVideo, unlockCampaignMap } from '../../../components/index.js';
import type { MissionPass } from '../pass.js';

export function allowCampaignMap(
  pass: MissionPass,
  mission: number,
  campaignId: number,
  mapId: number,
): void {
  if (campaignId < 0 || mapId < 0) {
    pass.reportFailed(mission, 'AllowMap');
    return;
  }
  if (unlockCampaignMap(pass.world, campaignId, mapId)) {
    pass.ctx.events.emit({ kind: 'missionCampaignUnlock', campaignId, mapId });
  }
}

export function playCampaignVideo(pass: MissionPass, mission: number, sequence: number): void {
  if (sequence < 0) {
    pass.reportFailed(mission, 'Mission quit and play video');
    return;
  }
  requestCampaignVideo(pass.world, sequence);
  pass.ctx.events.emit({ kind: 'missionVideo', sequence });
}
