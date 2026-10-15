import { foldText } from '../../../hud/dom/parts/name-search.js';

/** Folded letters and digits only: "PDP : 01 WRÓG" and "PDP 01: Wróg" give the same key. */
export function titleKey(text: string): string {
  return foldText(text).replace(/[^\p{L}\p{N}]+/gu, '');
}
