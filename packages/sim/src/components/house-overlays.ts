import { defineComponent } from '../ecs/world.js';

/** Original behavior: ten individually switchable landscape slots; unconfirmed on the running original. */
export const HOUSE_LANDSCAPE_OVERLAY_SLOTS = 10;

/** The slots a script switched on a house; a missing slot is off. */
export const HouseLandscapeOverlays = defineComponent<{
  slots: Map<number, boolean>;
}>('HouseLandscapeOverlays', 'economy');
