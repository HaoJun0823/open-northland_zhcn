import type { EntitySnapshot } from '@open-northland/sim';
import { buildUnitPanelModel, type UnitPanelModel } from '../../src/hud/details-panel/index.js';
import { sandboxCtx, snapshotOf } from './sandbox.js';

/** The panel model for one selected entity against the sandbox content. */
export const panelModelOf = (entity: EntitySnapshot): UnitPanelModel =>
  buildUnitPanelModel(snapshotOf([entity]), new Set([entity.id]), sandboxCtx());
