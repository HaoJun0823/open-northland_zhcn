import type { UnitVariant } from './schema/actors/tribes.js';
import type { ContentSet } from './schema/content/content-set.js';

export interface UnitIdentity {
  readonly tribe: number;
  readonly jobType: number | null;
  readonly scenario?: boolean | undefined;
}

/** A tribe job's first declared variant of each scenario flag. */
interface JobVariants {
  plain: UnitVariant | undefined;
  scenario: UnitVariant | undefined;
}

type VariantTable = Map<number, Map<number, JobVariants>>;
const tables = new WeakMap<ContentSet, VariantTable>();

function variantTable(content: ContentSet): VariantTable {
  let table = tables.get(content);
  if (table !== undefined) return table;
  table = new Map();
  for (const tribe of content.tribes) {
    const jobs = new Map<number, JobVariants>();
    for (const rule of tribe.unitVariants ?? []) {
      let variants = jobs.get(rule.jobType);
      if (variants === undefined) {
        variants = { plain: undefined, scenario: undefined };
        jobs.set(rule.jobType, variants);
      }
      if (rule.scenario) variants.scenario ??= rule;
      else variants.plain ??= rule;
    }
    table.set(tribe.typeId, jobs);
  }
  tables.set(content, table);
  return table;
}

/** Shared selection for combat, movement, health and animation. A controller flag never enters it. */
export function unitVariantFor(content: ContentSet, unit: UnitIdentity): UnitVariant | undefined {
  if (unit.jobType === null) return undefined;
  const variants = variantTable(content).get(unit.tribe)?.get(unit.jobType);
  if (variants === undefined) return undefined;
  return unit.scenario === true ? variants.scenario : variants.plain;
}
