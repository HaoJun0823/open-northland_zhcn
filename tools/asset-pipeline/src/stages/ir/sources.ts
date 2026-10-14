import { BUILDING_GRAPHICS_FILE } from '../../data-layout.js';
import { resolveSourceFile, type SourceRoots } from '../../roots.js';

export interface IniSource {
  /** Resolved root-joined path of the `.ini` file to read. */
  readonly path: string;
  /** Path stamped onto each record's `source.file` - relative so the IR is location-agnostic. */
  readonly file: string;
  /** Source layer retained for precedence over the original binary tables. */
  readonly layer: 'base' | 'mod';
}

/** Resolves readable rule tables in the data pack; missing tables warn and are skipped. */
export async function resolveIniSources(roots: SourceRoots): Promise<IniSource[]> {
  const wanted: { rel: string; layer: 'base' | 'mod' }[] = [
    { rel: 'Data/logic/goodtypes.ini', layer: 'base' },
    { rel: 'Data/logic/jobtypes.ini', layer: 'base' },
    { rel: 'Data/logic/humanjobexperiencetypes.ini', layer: 'base' },
    { rel: 'Data/logic/landscapetypes.ini', layer: 'base' },
    { rel: 'Data/logic/vehicletypes.ini', layer: 'base' },
    { rel: 'Data/logic/armortypes.ini', layer: 'base' },
    { rel: 'Data/logic/animaltypes.ini', layer: 'base' },
    { rel: 'rules/tribes/tribetypes.ini', layer: 'mod' },
    { rel: 'rules/atomic-animations/atomicanimations.ini', layer: 'mod' },
    { rel: 'rules/types/weapons.ini', layer: 'mod' },
    { rel: 'rules/types/houses.ini', layer: 'mod' },
    // The renderer's `[bobseq]` animation table.
    { rel: 'rules/map-animations/animations.ini', layer: 'mod' },
    // The `[GfxHouse]` graphics twin of the logic house table above.
    { rel: BUILDING_GRAPHICS_FILE, layer: 'mod' },
  ];
  const sources: IniSource[] = [];
  for (const { rel, layer } of wanted) {
    const path = await resolveSourceFile(roots, rel);
    if (path === undefined) {
      console.warn(`[pipeline] ini source not found, skipping: ${rel}`);
      continue;
    }
    sources.push({ path, file: rel, layer });
  }
  return sources;
}
