/** Lower case without diacritics, so "zolw" finds "Żółw". `ł` has no decomposition of its own. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l').replace(/Ł/g, 'l').toLowerCase();
}

/** Folded letters and digits only: "PDP : 01 WRÓG" and "PDP 01: Wróg" give the same key. */
export function titleKey(text: string): string {
  return foldText(text).replace(/[^\p{L}\p{N}]+/gu, '');
}
