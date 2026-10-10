/** Installed catalogue maps on disk, served back under `/maps/`; the shell validates every argument. */
export interface DesktopMaps {
  writeFile(mapId: string, suffix: string, bytes: Uint8Array): Promise<void>;
  /** Removes every file of the map. */
  remove(mapId: string): Promise<void>;
}

export function desktopMaps(): DesktopMaps | null {
  return typeof window === 'undefined' ? null : (window.desktop?.maps ?? null);
}
