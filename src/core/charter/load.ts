import type { Hasher, VaultReader } from '../ports';
import { type ExistingCharterNote, parseCharterNote } from './charter-note';
import type { Charter } from './schema';
import type { CharterIssue } from './yaml';

export type CharterLoad =
  | { status: 'missing'; path: string }
  | { status: 'no-block'; path: string; note: ExistingCharterNote }
  | { status: 'invalid'; path: string; issues: CharterIssue[]; note: ExistingCharterNote }
  | { status: 'ok'; path: string; charter: Charter; note: ExistingCharterNote };

/** Reads and validates the charter note at `path`. Never throws for bad content. */
export async function loadCharter(reader: VaultReader, hasher: Hasher, path: string): Promise<CharterLoad> {
  if (!(await reader.exists(path))) return { status: 'missing', path };
  const content = await reader.read(path);
  const note: ExistingCharterNote = { path, content, contentHash: await hasher.sha256(content) };
  const parsed = parseCharterNote(content);
  if (parsed.ok) return { status: 'ok', path, charter: parsed.value.charter, note };
  if (parsed.error.kind === 'missing-block') return { status: 'no-block', path, note };
  return { status: 'invalid', path, issues: parsed.error.issues, note };
}
