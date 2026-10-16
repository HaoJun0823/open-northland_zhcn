import type { NodeId } from '../terrain/index.js';
import type { SearchScratch } from './scratch.js';

/** The canonical open-set order (f, h, dev, node id), all ascending. Ending on the id makes it total, so
 *  the heap's minimum is unique and independent of the heap's internal layout. With f equal, the smaller
 *  h = f - g is the larger g. */
function better(
  fa: number,
  ga: number,
  devA: number,
  a: number,
  fb: number,
  gb: number,
  devB: number,
  b: number,
) {
  if (fa !== fb) return fa < fb;
  if (ga !== gb) return ga > gb;
  if (devA !== devB) return devA < devB;
  return a < b;
}

/** Append `node` with its open keys and restore the heap order, doubling the heap when it is full. */
export function heapPush(s: SearchScratch, node: NodeId, f: number, dev: number): void {
  const index = s.heapSize;
  if (index === s.heap.length) growHeap(s);
  s.heap[index] = node;
  s.heapF[index] = f;
  s.heapDev[index] = dev;
  s.heapSize += 1;
  siftUp(s, index);
}

/** Remove the root, moving the last slot to the top. The caller has read the root's node. */
export function heapPopRoot(s: SearchScratch): void {
  s.heapSize -= 1;
  const last = s.heapSize;
  if (last === 0) return;
  s.heap[0] = s.heap[last] ?? 0;
  s.heapF[0] = s.heapF[last] ?? 0;
  s.heapDev[0] = s.heapDev[last] ?? 0;
  siftDown(s, 0);
}

function growHeap(s: SearchScratch): void {
  const capacity = Math.min(s.heap.length * 2, s.heapIdx.length);
  const heap = new Int32Array(capacity);
  const heapF = new Float64Array(capacity);
  const heapDev = new Float64Array(capacity);
  heap.set(s.heap);
  heapF.set(s.heapF);
  heapDev.set(s.heapDev);
  s.heap = heap;
  s.heapF = heapF;
  s.heapDev = heapDev;
}

/** Move the slot at `heap[start]` toward the root until its parent is no better. */
export function siftUp(s: SearchScratch, start: number): void {
  const { heap, heapF, heapDev, heapIdx, g } = s;
  if (start >= s.heapSize) return;
  const node = heap[start] ?? 0;
  const f = heapF[start] ?? 0;
  const dev = heapDev[start] ?? 0;
  const nodeG = g[node] ?? 0;
  let index = start;
  while (index > 0) {
    const parentIndex = (index - 1) >> 1;
    const parent = heap[parentIndex] ?? 0;
    const parentF = heapF[parentIndex] ?? 0;
    const parentDev = heapDev[parentIndex] ?? 0;
    if (!better(f, nodeG, dev, node, parentF, g[parent] ?? 0, parentDev, parent)) break;
    heap[index] = parent;
    heapF[index] = parentF;
    heapDev[index] = parentDev;
    heapIdx[parent] = index;
    index = parentIndex;
  }
  heap[index] = node;
  heapF[index] = f;
  heapDev[index] = dev;
  heapIdx[node] = index;
}

/** Move the slot at `heap[start]` toward the leaves until neither child beats it. */
function siftDown(s: SearchScratch, start: number): void {
  const { heap, heapF, heapDev, heapIdx, g } = s;
  const size = s.heapSize;
  if (start >= size) return;
  const node = heap[start] ?? 0;
  const f = heapF[start] ?? 0;
  const dev = heapDev[start] ?? 0;
  const nodeG = g[node] ?? 0;
  let index = start;
  for (;;) {
    let childIndex = 2 * index + 1;
    if (childIndex >= size) break;
    let child = heap[childIndex] ?? 0;
    let childF = heapF[childIndex] ?? 0;
    let childDev = heapDev[childIndex] ?? 0;
    let childG = g[child] ?? 0;
    const rightIndex = childIndex + 1;
    if (rightIndex < size) {
      const right = heap[rightIndex] ?? 0;
      const rightF = heapF[rightIndex] ?? 0;
      const rightDev = heapDev[rightIndex] ?? 0;
      const rightG = g[right] ?? 0;
      if (better(rightF, rightG, rightDev, right, childF, childG, childDev, child)) {
        child = right;
        childF = rightF;
        childDev = rightDev;
        childG = rightG;
        childIndex = rightIndex;
      }
    }
    if (!better(childF, childG, childDev, child, f, nodeG, dev, node)) break;
    heap[index] = child;
    heapF[index] = childF;
    heapDev[index] = childDev;
    heapIdx[child] = index;
    index = childIndex;
  }
  heap[index] = node;
  heapF[index] = f;
  heapDev[index] = dev;
  heapIdx[node] = index;
}
