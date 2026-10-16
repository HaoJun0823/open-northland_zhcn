/** Derived libraries retain the palette layout of the stem before their numbered variant suffix. */
export function paletteLibrary(stem: string): string {
  return stem.replace(/_variant\d+$/, '');
}
