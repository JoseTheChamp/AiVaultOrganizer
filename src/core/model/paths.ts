/**
 * Vault-relative path helpers. Vault paths always use forward slashes, have no leading or trailing
 * slash, and the vault root is the empty string. Mirrors Obsidian's `normalizePath` closely enough
 * for core logic, which cannot import Obsidian.
 */

export function normalizeVaultPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/').normalize('NFC');
}

export function joinPath(...segments: string[]): string {
  return normalizeVaultPath(segments.filter((s) => s.length > 0).join('/'));
}

/** Parent folder of a path; `''` for items in the vault root. */
export function parentFolder(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/** File name including extension. */
export function fileName(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** Lowercase extension without the dot; `''` when there is none. */
export function extension(path: string): string {
  const name = fileName(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

/** File name without its extension. */
export function baseName(path: string): string {
  const name = fileName(path);
  const index = name.lastIndexOf('.');
  return index <= 0 ? name : name.slice(0, index);
}

/** Number of folders between the vault root and the item (`a.md` → 0, `x/y/a.md` → 2). */
export function depth(path: string): number {
  return path === '' ? 0 : path.split('/').length - 1;
}

/** All ancestor folders of a path, from the top level down (`a/b/c.md` → `['a', 'a/b']`). */
export function ancestorFolders(path: string): string[] {
  const parts = path.split('/');
  const result: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    result.push(parts.slice(0, i).join('/'));
  }
  return result;
}

/** True when `path` equals `folder` or lies somewhere below it. The root contains everything. */
export function isInFolder(path: string, folder: string): boolean {
  if (folder === '') return true;
  return path === folder || path.startsWith(`${folder}/`);
}
