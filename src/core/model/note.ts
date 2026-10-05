/**
 * The read model of a vault: what the analysis, planner and drift detector know about notes.
 * Built by a `VaultReader` adapter (Obsidian metadata cache, Node filesystem, or in-memory for tests).
 * Note bodies are deliberately not part of it; they are read on demand through `VaultReader.read`.
 */

export interface Heading {
  level: number;
  text: string;
}

export interface NoteRecord {
  /** Vault-relative path including the `.md` extension. */
  path: string;
  /** File name without extension, i.e. the note title Obsidian shows. */
  basename: string;
  /** Parent folder; `''` for notes in the vault root. */
  folder: string;
  /** Last modification time, epoch milliseconds. */
  mtime: number;
  /** Creation time, epoch milliseconds (may equal mtime on filesystems that don't track it). */
  ctime: number;
  /** Size in bytes. */
  size: number;
  /** SHA-256 (hex) of the raw file content; the identity used by preconditions and undo. */
  contentHash: string;
  /** Parsed YAML frontmatter; `{}` when absent or invalid. */
  frontmatter: Record<string, unknown>;
  /** Tags without `#`, original casing, frontmatter tags first then inline tags, de-duplicated. */
  tags: string[];
  headings: Heading[];
  /** Paths of notes this note links to or embeds (resolved, unique, sorted). Attachments excluded. */
  outLinks: string[];
  /** Link targets that resolve to no file (unique, sorted, as written without alias/subpath). */
  unresolvedLinks: string[];
  /** Paths of notes that link to this note (unique, sorted). */
  inLinks: string[];
  /** Words in the body (frontmatter and code blocks excluded). */
  wordCount: number;
}

/** A non-Markdown file: attachment, canvas, base, PDF, … */
export interface OtherFile {
  path: string;
  extension: string;
  size: number;
}

export interface VaultSnapshot {
  /** Notes sorted by path. Ignored paths are already excluded. */
  notes: NoteRecord[];
  /** Every folder below the root (including empty ones), sorted. */
  folders: string[];
  /** Non-Markdown files, sorted by path. */
  otherFiles: OtherFile[];
  /** Epoch milliseconds when the snapshot was taken. */
  takenAt: number;
}

/** Folders the plugin never reads or writes as vault content. */
export const PLUGIN_DATA_FOLDER = '.ai-vault-organizer';
