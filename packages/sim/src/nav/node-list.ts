import type { NodeId } from './terrain/index.js';

/** Scratch node ids filled by count and never truncated, so a reused list keeps its capacity: setting a
 *  plain array's length to zero drops its backing store, and every refill then grows it again. */
export class NodeList {
  readonly nodes: NodeId[] = [];
  length = 0;

  push(node: NodeId): void {
    this.nodes[this.length++] = node;
  }

  /** The node at `i`, which must lie below {@link length}. */
  at(i: number): NodeId {
    return this.nodes[i] as NodeId;
  }

  clear(): void {
    this.length = 0;
  }
}
