/** One line of a diff: kept as it was, added, or removed. A `gap` stands for unchanged lines left out. */
export type DiffLine = { type: 'same' | 'add' | 'remove'; text: string } | { type: 'gap'; count: number };

/** Notes larger than this are compared by their changed region only (see `lineDiff`). */
const MAX_DP_CELLS = 4_000_000;

/**
 * Line diff of two texts (longest common subsequence), with unchanged lines more than `context`
 * lines away from a change collapsed into gaps. Meant for previews of small edits to notes: the
 * common prefix and suffix are trimmed first, so only the changed region is compared in full.
 */
export function lineDiff(before: string, after: string, context = 2): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = diffRegion(a.slice(start, endA), b.slice(start, endB));
  const lines: DiffLine[] = [...a.slice(0, start).map((text) => same(text)), ...middle, ...a.slice(endA).map((text) => same(text))];
  return collapse(lines, context);
}

function same(text: string): DiffLine {
  return { type: 'same', text };
}

function diffRegion(a: readonly string[], b: readonly string[]): DiffLine[] {
  if (a.length * b.length > MAX_DP_CELLS) {
    return [...a.map((text): DiffLine => ({ type: 'remove', text })), ...b.map((text): DiffLine => ({ type: 'add', text }))];
  }
  // lengths[i][j]: longest common subsequence of a[i..] and b[j..].
  const width = b.length + 1;
  const lengths = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j] ? (lengths[(i + 1) * width + j + 1] ?? 0) + 1 : Math.max(lengths[(i + 1) * width + j] ?? 0, lengths[i * width + j + 1] ?? 0);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(same(a[i] as string));
      i++;
      j++;
    } else if (i < a.length && (j === b.length || (lengths[(i + 1) * width + j] ?? 0) >= (lengths[i * width + j + 1] ?? 0))) {
      // On a tie, removals first: a replaced line reads as "old, then new".
      lines.push({ type: 'remove', text: a[i] as string });
      i++;
    } else {
      lines.push({ type: 'add', text: b[j] as string });
      j++;
    }
  }
  return lines;
}

function collapse(lines: readonly DiffLine[], context: number): DiffLine[] {
  const changed = lines.map((line) => line.type === 'add' || line.type === 'remove');
  const keep = lines.map((_, index) => {
    for (let k = Math.max(0, index - context); k <= Math.min(lines.length - 1, index + context); k++) if (changed[k]) return true;
    return false;
  });
  const result: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped > 0) result.push({ type: 'gap', count: skipped });
      skipped = 0;
      result.push(line);
    } else {
      skipped++;
    }
  });
  if (skipped > 0 && result.length > 0) result.push({ type: 'gap', count: skipped });
  return result;
}
