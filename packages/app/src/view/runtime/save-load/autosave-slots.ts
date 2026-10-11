// Slashes cannot occur in a manually entered save name; map IDs isolate each map's rotation.
export function autosaveSlots(mapId: string | null): readonly string[] {
  return [1, 2, 3].map((slot) => `/autosave/${JSON.stringify(mapId)}/${slot}`);
}

export function autosaveNumber(id: string): string | null {
  const match = /^\/autosave\/(?:null|"(?:[^"\\]|\\.)*")\/([123])$/.exec(id);
  return match?.[1] ?? null;
}
