export interface PriorityQueueItem {
  timestamp: number;
  seq: number;
}

/**
 * Deterministic binary min-heap priority queue ordered by (timestamp, seq).
 */
export class MinPriorityQueue<T extends PriorityQueueItem> {
  private heap: T[] = [];

  get size(): number {
    return this.heap.length;
  }

  clear(): void {
    this.heap = [];
  }

  peek(): T | undefined {
    return this.heap[0];
  }

  push(item: T): void {
    this.heap.push(item);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private compare(a: T, b: T): number {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.seq - b.seq;
  }

  private bubbleUp(idx: number): void {
    const item = this.heap[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = this.heap[parentIdx];
      if (this.compare(item, parent) >= 0) break;
      this.heap[idx] = parent;
      idx = parentIdx;
    }
    this.heap[idx] = item;
  }

  private sinkDown(idx: number): void {
    const length = this.heap.length;
    const item = this.heap[idx];
    while (true) {
      const leftIdx = (idx << 1) + 1;
      const rightIdx = leftIdx + 1;
      let swapIdx = -1;

      if (leftIdx < length && this.compare(this.heap[leftIdx], item) < 0) {
        swapIdx = leftIdx;
      }
      if (
        rightIdx < length &&
        this.compare(this.heap[rightIdx], swapIdx === -1 ? item : this.heap[leftIdx]) < 0
      ) {
        swapIdx = rightIdx;
      }
      if (swapIdx === -1) break;
      this.heap[idx] = this.heap[swapIdx];
      idx = swapIdx;
    }
    this.heap[idx] = item;
  }
}
