/** A similar note and how similar it is (cosine similarity, -1..1; in practice 0..1). */
export interface Neighbor {
  path: string;
  score: number;
}

export interface Scored {
  index: number;
  score: number;
}

/**
 * The `k` highest scores, best first, skipping indexes for which `skip` returns true. A min-heap of
 * size k keeps this O(n log k), so ranking a large vault costs little more than scoring it. Ties go
 * to the lower index, which keeps results deterministic.
 */
export function topK(scores: ArrayLike<number>, k: number, skip: (index: number) => boolean = () => false): Scored[] {
  if (k <= 0) return [];
  const heap: Scored[] = [];
  for (let index = 0; index < scores.length; index++) {
    if (skip(index)) continue;
    const score = scores[index] ?? 0;
    if (Number.isNaN(score)) continue;
    if (heap.length < k) {
      heap.push({ index, score });
      siftUp(heap, heap.length - 1);
    } else if (worse(heap[0] as Scored, { index, score })) {
      heap[0] = { index, score };
      siftDown(heap, 0);
    }
  }
  return heap.sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Whether `a` ranks below `b`: lower score, or equal score and higher index. */
function worse(a: Scored, b: Scored): boolean {
  return a.score < b.score || (a.score === b.score && a.index > b.index);
}

function siftUp(heap: Scored[], start: number): void {
  let i = start;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!worse(heap[i] as Scored, heap[parent] as Scored)) break;
    [heap[i], heap[parent]] = [heap[parent] as Scored, heap[i] as Scored];
    i = parent;
  }
}

function siftDown(heap: Scored[], start: number): void {
  let i = start;
  for (;;) {
    const left = 2 * i + 1;
    const right = left + 1;
    let smallest = i;
    if (left < heap.length && worse(heap[left] as Scored, heap[smallest] as Scored)) smallest = left;
    if (right < heap.length && worse(heap[right] as Scored, heap[smallest] as Scored)) smallest = right;
    if (smallest === i) return;
    [heap[i], heap[smallest]] = [heap[smallest] as Scored, heap[i] as Scored];
    i = smallest;
  }
}
