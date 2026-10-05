/** Opening or closing line of a fenced code block (``` or ~~~, up to three spaces of indent). */
export const FENCE = /^ {0,3}(`{3,}|~{3,})/;

const INLINE_CODE = /(`+)[^`]*?\1/g;

/**
 * Applies `fn` to every piece of prose in `text`, leaving fenced code blocks, inline code spans and
 * line endings untouched. Edits that must not change code (tag renames, link rewrites) go through
 * here so their notion of "code" matches the parser's.
 */
export function mapProse(text: string, fn: (segment: string) => string): string {
  const parts = text.split(/(\r?\n)/);
  let fence: string | null = null;
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i] ?? '';
    const marker = FENCE.exec(line)?.[1];
    if (fence !== null) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    parts[i] = mapOutsideInlineCode(line, fn);
  }
  return parts.join('');
}

function mapOutsideInlineCode(line: string, fn: (segment: string) => string): string {
  let result = '';
  let last = 0;
  for (const match of line.matchAll(INLINE_CODE)) {
    result += fn(line.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return result + fn(line.slice(last));
}
