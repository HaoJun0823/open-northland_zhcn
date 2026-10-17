/** A byte diff the fog mask readers outside the sim share; it reads nothing of the sim itself. */
const WORD_BYTES = Uint32Array.BYTES_PER_ELEMENT;

/**
 * Call `visit` with each index whose byte differs between two equal-length mask copies, in ascending
 * order, until it returns false. A mask is a few hundred kilobytes, so the scan compares a 32-bit word
 * at a time where both arrays allow a word view.
 */
export function scanChangedBytes(a: Uint8Array, b: Uint8Array, visit: (index: number) => boolean): void {
  let from = 0;
  if (a.byteOffset % WORD_BYTES === 0 && b.byteOffset % WORD_BYTES === 0) {
    const words = Math.floor(a.length / WORD_BYTES);
    const aw = new Uint32Array(a.buffer, a.byteOffset, words);
    const bw = new Uint32Array(b.buffer, b.byteOffset, words);
    for (let w = 0; w < words; w++) {
      if (aw[w] === bw[w]) continue;
      for (let i = w * WORD_BYTES; i < (w + 1) * WORD_BYTES; i++) if (a[i] !== b[i] && !visit(i)) return;
    }
    from = words * WORD_BYTES;
  }
  for (let i = from; i < a.length; i++) if (a[i] !== b[i] && !visit(i)) return;
}
