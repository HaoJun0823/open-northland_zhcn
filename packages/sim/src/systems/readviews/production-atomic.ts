import type { ContentSet } from '@open-northland/data';
import type { SettlerIdentity } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { atomicClipName } from './animations.js';

const cache = new WeakMap<ContentSet, Map<string, number | undefined>>();

/** Prefer the good's declared atomic when bound. If the trade cannot bind it, use its unique allowed
 * `setatomic` clip ending in `_produce_<good id>`. This naming-based repair is an approximation of the
 * original lookup; the source has disagreements for iron tools and wooden spears. */
export function productionAtomic(
  content: ContentSet,
  settler: SettlerIdentity,
  goodType: number,
): number | undefined {
  let byMaker = cache.get(content);
  if (byMaker === undefined) {
    byMaker = new Map();
    cache.set(content, byMaker);
  }
  const key = `${settler.scenario === true}:${settler.tribe}:${settler.jobType}:${goodType}`;
  if (byMaker.has(key)) return byMaker.get(key);
  const index = contentIndex(content);
  const good = index.goods.get(goodType);
  let atomic = good?.atomics.produce;
  if (good !== undefined && atomic !== undefined && atomicClipName(content, settler, atomic) === undefined) {
    const allowed = settler.jobType === null ? undefined : index.atomicsByJob.get(settler.jobType);
    const matches = [...(allowed ?? [])].filter((id) =>
      atomicClipName(content, settler, id)?.endsWith(`_produce_${good.id}`),
    );
    if (matches.length === 1) atomic = matches[0];
  }
  byMaker.set(key, atomic);
  return atomic;
}
