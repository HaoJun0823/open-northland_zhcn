/** The shell publishes installed files and metadata together and returns coherent file snapshots. */
export interface DesktopMaps {
  readFile(mapId: string, suffix: string): Promise<Uint8Array | null>;
  list(): Promise<readonly unknown[]>;
  readMap(
    mapId: string,
  ): Promise<{ readonly record: unknown; readonly files: readonly (readonly [string, Uint8Array])[] }>;
  commit(
    drop: readonly string[],
    put: readonly { readonly record: unknown; readonly files: readonly (readonly [string, Uint8Array])[] }[],
  ): Promise<void>;
}

export function desktopMaps(): DesktopMaps | null {
  return typeof window === 'undefined' ? null : (window.desktop?.maps ?? null);
}
