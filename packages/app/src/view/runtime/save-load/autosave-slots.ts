import { AUTOSAVE_COUNTS } from '../../settings-store.js';

/** Every slot a rotation may use; slots past the chosen count are the ones a smaller count prunes. */
const MAX_AUTOSAVE_SLOTS = Math.max(...AUTOSAVE_COUNTS);

// Slashes cannot occur in a manually entered save name; map IDs isolate each map's rotation.
export function autosaveSlots(mapId: string | null, count: number = MAX_AUTOSAVE_SLOTS): readonly string[] {
  return Array.from({ length: count }, (_, i) => `/autosave/${JSON.stringify(mapId)}/${i + 1}`);
}

export function autosaveNumber(id: string): string | null {
  const match = /^\/autosave\/(?:null|"(?:[^"\\]|\\.)*")\/([1-9]\d*)$/.exec(id);
  const slot = match?.[1];
  return slot !== undefined && Number(slot) <= MAX_AUTOSAVE_SLOTS ? slot : null;
}
