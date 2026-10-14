export const DATA_PACK_VERSION: 2;
export const DATA_PACK_FORMAT: 'open-northland-data';
export interface DataManifest {
  readonly format: typeof DATA_PACK_FORMAT;
  readonly version: typeof DATA_PACK_VERSION;
  readonly base: 'base';
  readonly components: readonly {
    readonly id: string;
    readonly kind: 'base' | 'animation';
    readonly sha256: string;
  }[];
  readonly campaigns: readonly string[];
  readonly files: readonly { readonly path: string; readonly size: number; readonly sha256: string }[];
}
export function dataPath(value: unknown): string;
export function parseDataManifest(value: unknown): DataManifest;
export function sha256File(path: string): Promise<string>;
export function readDataPack(root: string): Promise<DataManifest>;
export function readCampaignMap(
  root: string,
  campaignId: string,
  mapId: string,
  language: string,
): Promise<Map<string, Uint8Array>>;
