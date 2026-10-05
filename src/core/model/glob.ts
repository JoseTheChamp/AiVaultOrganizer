/**
 * Minimal glob matching for vault-relative paths (ignore lists, charter rules).
 *
 * Supported syntax: `**` (any characters including `/`), `**\/` (zero or more folders), `*` (any
 * characters except `/`), `?` (one character except `/`), `{a,b}` (alternatives, not nested) and
 * `[abc]` character classes. A pattern without wildcards also matches everything below it, so
 * `Templates` ignores the whole folder. Matching is case-sensitive, like Obsidian paths.
 */

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;

  const pattern = glob.replace(/^\/+/, '');
  const hasWildcard = /[*?[{]/.test(pattern);
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char === '*') {
      if (pattern.charAt(i + 1) === '*') {
        const followedBySlash = pattern.charAt(i + 2) === '/';
        source += followedBySlash ? '(?:.*/)?' : '.*';
        i += followedBySlash ? 2 : 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '{') {
      const end = pattern.indexOf('}', i);
      if (end === -1) {
        source += '\\{';
        continue;
      }
      const options = pattern.slice(i + 1, end).split(',').map(escapeRegExp);
      source += `(?:${options.join('|')})`;
      i = end;
    } else if (char === '[') {
      const end = pattern.indexOf(']', i);
      if (end === -1) {
        source += '\\[';
        continue;
      }
      source += pattern.slice(i, end + 1);
      i = end;
    } else {
      source += escapeRegExp(char);
    }
  }

  const trimmed = source.replace(/\/$/, '');
  const regex = new RegExp(hasWildcard && !pattern.endsWith('/') ? `^${source}$` : `^${trimmed}(?:/.*)?$`);
  cache.set(glob, regex);
  return regex;
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchesAnyGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
