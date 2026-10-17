import type { Entity } from '../../ecs/world.js';

/** The last epoch before the marks are cleared and counting restarts. */
const MAX_EPOCH = 0xffffffff;

/**
 * Per-entity marks valid for one round: {@link begin} starts a round in O(1), so a pass marks the entities
 * it meets without a set per pass. Indexed by entity id and grown on demand.
 */
export class EpochMarks {
  private marks = new Uint32Array(0);
  private epoch = 0;

  /** Start a round: no entity is marked in it yet. */
  begin(): void {
    if (this.epoch === MAX_EPOCH) {
      this.marks.fill(0);
      this.epoch = 0;
    }
    this.epoch++;
  }

  mark(e: Entity): void {
    if (e >= this.marks.length) {
      const grown = new Uint32Array(Math.max(e + 1, 2 * this.marks.length));
      grown.set(this.marks);
      this.marks = grown;
    }
    this.marks[e] = this.epoch;
  }

  has(e: Entity): boolean {
    return this.marks[e] === this.epoch;
  }

  /** Whether this round meets `e` for the first time, marking it. */
  firstMark(e: Entity): boolean {
    if (this.has(e)) return false;
    this.mark(e);
    return true;
  }
}
