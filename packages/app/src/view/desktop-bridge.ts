export type DesktopLocalMapInput =
  | { readonly kind: 'archive'; readonly name: string; readonly bytes: Uint8Array }
  | {
      readonly kind: 'folder';
      readonly name: string;
      readonly files: readonly { readonly path: string; readonly bytes: Uint8Array }[];
    };
export type DesktopMapPick =
  | { readonly kind: 'picked'; readonly input: DesktopLocalMapInput }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'failed';
      readonly failure: 'too-large' | 'unsupported-archive' | 'read-failed';
      readonly message: string;
    };
export interface DesktopSourceChanges {
  readonly drop: readonly string[];
  readonly put?: { readonly record: unknown; readonly input: DesktopLocalMapInput };
  readonly expected?: unknown;
}

/** The shell publishes installed files and metadata together and returns coherent file snapshots. */
export interface DesktopMaps {
  drop(file: File): Promise<DesktopMapPick>;
  pick(kind: 'archive' | 'folder'): Promise<DesktopMapPick>;
  cancelPick(): Promise<void>;
  readSource(
    entryId: string,
  ): Promise<{ readonly record: unknown; readonly input: DesktopLocalMapInput } | null>;
  readFile(mapId: string, suffix: string): Promise<Uint8Array | null>;
  list(): Promise<readonly unknown[]>;
  readMap(
    mapId: string,
  ): Promise<{ readonly record: unknown; readonly files: readonly (readonly [string, Uint8Array])[] }>;
  commit(
    drop: readonly string[],
    put: readonly { readonly record: unknown; readonly files: readonly (readonly [string, Uint8Array])[] }[],
    sources?: DesktopSourceChanges,
  ): Promise<void>;
}

export function desktopMaps(): DesktopMaps | null {
  return typeof window === 'undefined' ? null : (window.desktop?.maps ?? null);
}
