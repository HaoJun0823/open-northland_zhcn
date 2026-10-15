import { type ContentSet, cadaverStageGoods } from '@open-northland/data';

/**
 * The goods one pluck of each cadaver stage yields, in stage order ({@link cadaverStageGoods}: leather,
 * then meat), so the body alternates until its valency runs out. A good with no harvest atomic ends the
 * cycle, since nothing could pluck it; empty when the content has no such chain.
 */
export function cadaverGoodCycle(content: ContentSet): readonly number[] {
  const harvestable = new Set(
    content.goods.filter((g) => g.atomics.harvest !== undefined).map((g) => g.typeId),
  );
  const goods = cadaverStageGoods(content.landscape);
  const end = goods.findIndex((good) => !harvestable.has(good));
  return end === -1 ? goods : goods.slice(0, end);
}
