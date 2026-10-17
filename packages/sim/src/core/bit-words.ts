/** Bits per word of a `Uint32Array` bitset: bit `i` lives in word `i >>> WORD_SHIFT` under mask
 *  `1 << (i & BIT_MASK)`. */
export const WORD_SHIFT = 5;
export const BITS_PER_WORD = 1 << WORD_SHIFT;
export const BIT_MASK = BITS_PER_WORD - 1;
