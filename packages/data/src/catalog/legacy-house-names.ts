/**
 * House names community maps author that neither the mod's nor the base house table defines, each to
 * the mod's house drawn and played in its place. Source basis: the mod's shipped copies of nine
 * community maps rewrite exactly these `sethouse` rows at unchanged anchors and levels. A level the
 * copies never rewrite keeps the same mapping (approximation). Original behavior (unconfirmed): it
 * leaves these houses out, so the mapping is a deliberate departure that keeps such maps playable.
 */
const LEGACY_HOUSE_NAMES: ReadonlyMap<string, string> = new Map([
  ['byzantine armory', 'byzantine manson'],
  ['byzantine bakery', 'byzantine market'],
  ['byzantine brewery', 'byzantine work02'],
  ['byzantine farm', 'byzantine harbour02'],
  ['byzantine headquarters house', 'byzantine cathedral'],
  ['byzantine joinery', 'byzantine work03'],
  ['byzantine mason hut', 'byzantine doorhouse'],
  ['byzantine pottery', 'byzantine palace'],
  ['byzantine sewery', 'byzantine work01'],
  ['byzantine smithy', 'byzantine chapel'],
  ['byzantine stock', 'byzantine harbour01'],
  ['frank coin mint', 'viking coin mint'],
]);

/** The defined house name a legacy `sethouse` name stands for, matched case-insensitively and whole,
 *  like a defined name. */
export function legacyHouseName(name: string): string | undefined {
  return LEGACY_HOUSE_NAMES.get(name.toLowerCase());
}
