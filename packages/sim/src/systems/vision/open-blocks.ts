/** Cells per block side, a power of two so a cell finds its block by a shift. */
const BLOCK_SHIFT = 3;

/**
 * One group mask's blocks of cells, each counting the cells a stamp could still raise. A stamp whose box
 * covers only closed blocks writes nothing, so it is skipped without walking its cells. Derived
 * bookkeeping, never hashed or saved.
 */
export class OpenBlocks {
  private readonly blocksWide: number;
  /** Per block, its raisable cells; at most 64, the cells of one block. */
  private readonly counts: Uint8Array;

  /** Every block closed; the owner opens each raisable cell. */
  constructor(cellsWide: number, cellsHigh: number) {
    this.blocksWide = (cellsWide >> BLOCK_SHIFT) + 1;
    this.counts = new Uint8Array(this.blocksWide * ((cellsHigh >> BLOCK_SHIFT) + 1));
  }

  /** Cell (c, r) became raisable. */
  open(c: number, r: number): void {
    const block = (r >> BLOCK_SHIFT) * this.blocksWide + (c >> BLOCK_SHIFT);
    this.counts[block] = (this.counts[block] ?? 0) + 1;
  }

  /** Cell (c, r), raisable until now, was raised. */
  close(c: number, r: number): void {
    const block = (r >> BLOCK_SHIFT) * this.blocksWide + (c >> BLOCK_SHIFT);
    this.counts[block] = (this.counts[block] ?? 0) - 1;
  }

  /** No cell is raisable any more. */
  closeAll(): void {
    this.counts.fill(0);
  }

  /** Whether no cell of the inclusive in-grid cell box is raisable. */
  closed(minC: number, maxC: number, minR: number, maxR: number): boolean {
    const bcLo = minC >> BLOCK_SHIFT;
    const bcHi = maxC >> BLOCK_SHIFT;
    for (let br = minR >> BLOCK_SHIFT; br <= maxR >> BLOCK_SHIFT; br++) {
      const base = br * this.blocksWide;
      for (let bc = bcLo; bc <= bcHi; bc++) if (this.counts[base + bc] !== 0) return false;
    }
    return true;
  }

  equals(other: OpenBlocks): boolean {
    return (
      other.counts.length === this.counts.length && other.counts.every((count, i) => this.counts[i] === count)
    );
  }
}
