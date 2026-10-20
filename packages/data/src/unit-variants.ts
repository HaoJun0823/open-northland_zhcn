import type { UnitVariant } from './schema/actors/tribes.js';
import type { ContentSet } from './schema/content/content-set.js';

/** The `(tribe, job)` pair plus the form a unit took when it was given the trade. */
export interface UnitIdentity {
  readonly tribe: number;
  readonly jobType: number | null;
  /** The unit is in its human form; unset is the native form (`UnitForm`). */
  readonly humanForm?: boolean | undefined;
}

/** A tribe job's first declared variant of each form. */
interface JobVariants {
  native: UnitVariant | undefined;
  human: UnitVariant | undefined;
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
        variants = { native: undefined, human: undefined };
        jobs.set(rule.jobType, variants);
      }
      variants[rule.form] ??= rule;
    }
    table.set(tribe.typeId, jobs);
  }
  tables.set(content, table);
  return table;
}

/** Shared selection for combat, movement, health and animation. Who owns the unit never enters it. */
export function unitVariantFor(content: ContentSet, unit: UnitIdentity): UnitVariant | undefined {
  if (unit.jobType === null) return undefined;
  const variants = variantTable(content).get(unit.tribe)?.get(unit.jobType);
  if (variants === undefined) return undefined;
  return unit.humanForm === true ? variants.human : variants.native;
}

/** Whether `tribe`'s `jobType` declares a human form at all; a class without one has only its native form. */
export function hasHumanForm(content: ContentSet, tribe: number, jobType: number | null): boolean {
  return jobType !== null && variantTable(content).get(tribe)?.get(jobType)?.human !== undefined;
}
