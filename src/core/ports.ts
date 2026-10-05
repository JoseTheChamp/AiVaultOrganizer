/**
 * Ports: the only ways the core talks to the outside world. Implemented by adapters in
 * `src/obsidian/adapters` (inside the app), `eval/adapters` (Node CLI) and `src/core/testing` (tests).
 * See docs/adr/0001-hexagonal-core.md.
 */
import type { VaultSnapshot } from './model/note';

export interface SnapshotOptions {
  /** Globs (vault-relative) whose notes are left out of the snapshot entirely. */
  ignore?: readonly string[];
}

export interface VaultReader {
  snapshot(options?: SnapshotOptions): Promise<VaultSnapshot>;
  /** Raw content of a file, including frontmatter. */
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

/**
 * Vault mutations. Used ONLY by the apply executor (invariant 2: single write path).
 * Deliberately has no delete: the plugin can only trash files it created itself.
 */
export interface VaultWriter {
  createFolder(path: string): Promise<void>;
  /** Moves or renames a note; adapters must update links (Obsidian: `fileManager.renameFile`). */
  move(from: string, to: string): Promise<void>;
  processFrontmatter(path: string, fn: (frontmatter: Record<string, unknown>) => void): Promise<void>;
  /** Atomic read-modify-write of the whole file content. */
  processBody(path: string, fn: (content: string) => string): Promise<void>;
  create(path: string, content: string): Promise<void>;
  /** Sends a file the plugin created to the trash. Never used for user content (invariant 1). */
  trashPluginCreated(path: string): Promise<void>;
  /** Removes a folder only if it is empty; returns whether it was removed. */
  removeEmptyFolder(path: string): Promise<boolean>;
  /** Resolves once the link index reflects all previous writes (Obsidian: metadataCache 'resolved'). */
  waitForIndex(): Promise<void>;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
}

/** Network access. Inside Obsidian this is `requestUrl`; never `fetch` (invariant 5). */
export interface HttpPort {
  request(request: HttpRequest): Promise<HttpResponse>;
}

/** Read access to API keys stored in Obsidian's SecretStorage, by secret name. */
export interface SecretsPort {
  get(name: string): Promise<string | null>;
}

/**
 * The plugin's own storage under `.ai-vault-organizer/` (caches, journals, backups, plans).
 * Keys are relative paths inside that folder. Never used for vault content.
 */
export interface StoragePort {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, data: Uint8Array): Promise<void>;
  append(key: string, data: Uint8Array): Promise<void>;
  list(prefix: string): Promise<string[]>;
  /** Removes one of the plugin's own files (e.g. pruning old backups). */
  remove(key: string): Promise<void>;
}

export interface Clock {
  now(): number;
}

export interface Hasher {
  /** Lowercase hex SHA-256 of the UTF-8 encoding of a string, or of raw bytes. */
  sha256(data: string | Uint8Array): Promise<string>;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export const systemClock: Clock = { now: () => Date.now() };

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
