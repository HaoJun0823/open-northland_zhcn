import type { NodeId } from './terrain/index.js';

/** Scratch node ids filled by count and never truncated, so a reused list keeps its capacity: setting a
 *  plain array's length to zero drops its backing store, and every refill then grows it again. */
export class NodeList {
  readonly nodes: NodeId[] = [];
  length = 0;

  push(node: NodeId): void {
    this.nodes[this.length++] = node;
  }

  /** The node at `i`; a slot at or past {@link length} holds a stale node and is refused. */
  at(i: number): NodeId {
    if (i >= this.length) throw new RangeError(`NodeList.at(${i}) past length ${this.length}`);
    return this.nodes[i] as NodeId;
  }

  clear(): void {
    this.length = 0;
  }
}
