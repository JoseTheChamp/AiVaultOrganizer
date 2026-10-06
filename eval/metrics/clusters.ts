export interface ClusterMetrics {
  /** Adjusted Rand index: 1 identical, 0 no better than chance. */
  ari: number;
  /** Normalized mutual information (arithmetic mean normalization): 1 identical, 0 independent. */
  nmi: number;
  clusters: number;
}

/** Agreement between a clustering and the topic labels, over the notes both label (PLAN §8.2). */
export function clusterMetrics(predicted: ReadonlyMap<string, string>, truth: ReadonlyMap<string, string>): ClusterMetrics {
  const paths = [...predicted.keys()].filter((path) => truth.has(path));
  const a = paths.map((path) => truth.get(path) as string);
  const b = paths.map((path) => predicted.get(path) as string);
  return { ari: adjustedRandIndex(a, b), nmi: normalizedMutualInformation(a, b), clusters: new Set(b).size };
}

export function adjustedRandIndex(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  if (n < 2) return 1;
  const { table, rows, cols } = contingency(a, b);
  const choose2 = (x: number): number => (x * (x - 1)) / 2;
  let index = 0;
  for (const count of table.values()) index += choose2(count);
  let sumRows = 0;
  for (const count of rows.values()) sumRows += choose2(count);
  let sumCols = 0;
  for (const count of cols.values()) sumCols += choose2(count);
  const expected = (sumRows * sumCols) / choose2(n);
  const max = (sumRows + sumCols) / 2;
  // Both labelings put everything in one cluster (or all singletons): identical by definition.
  if (max === expected) return 1;
  return (index - expected) / (max - expected);
}

export function normalizedMutualInformation(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  if (n === 0) return 1;
  const { table, rows, cols } = contingency(a, b);
  let mi = 0;
  for (const [key, count] of table) {
    const [row, col] = key.split('\u0000') as [string, string];
    mi += (count / n) * Math.log((n * count) / ((rows.get(row) ?? 1) * (cols.get(col) ?? 1)));
  }
  const entropy = (counts: Iterable<number>): number => {
    let h = 0;
    for (const count of counts) h -= (count / n) * Math.log(count / n);
    return h;
  };
  const ha = entropy(rows.values());
  const hb = entropy(cols.values());
  if (ha === 0 && hb === 0) return 1;
  const mean = (ha + hb) / 2;
  return mean === 0 ? 0 : mi / mean;
}

function contingency(a: readonly string[], b: readonly string[]) {
  const table = new Map<string, number>();
  const rows = new Map<string, number>();
  const cols = new Map<string, number>();
  a.forEach((label, i) => {
    const other = b[i] ?? '';
    table.set(`${label}\u0000${other}`, (table.get(`${label}\u0000${other}`) ?? 0) + 1);
    rows.set(label, (rows.get(label) ?? 0) + 1);
    cols.set(other, (cols.get(other) ?? 0) + 1);
  });
  return { table, rows, cols };
}
