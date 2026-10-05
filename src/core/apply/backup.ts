import { strFromU8, strToU8, unzipSync, zip, type Zippable, zipSync } from 'fflate';
import * as z from 'zod';
import type { Clock, Hasher, Logger, StoragePort, VaultReader } from '../ports';

/** Text formats a plan can change directly or through link updates. */
const TEXT_EXTENSIONS = new Set(['canvas', 'base']);
const PREFIX = 'backups/';
const BACKUP_NAME = /^backups\/\d{8}T\d{6}Z-[\w.-]+\.zip$/;

export const backupManifestSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  planId: z.string().nullable(),
  pluginVersion: z.string(),
  includesAttachments: z.boolean(),
  files: z.array(z.object({ path: z.string(), size: z.number().int(), sha256: z.string() })),
});

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export interface BackupOptions {
  planId?: string | null;
  pluginVersion: string;
  /** v1 never modifies attachments, so they are left out unless the user opts in. */
  includeAttachments?: boolean;
}

export interface BackupResult {
  key: string;
  manifest: BackupManifest;
  bytes: number;
}

export interface BackupDeps {
  reader: VaultReader;
  storage: StoragePort;
  hasher: Hasher;
  clock: Clock;
  logger: Logger;
}

/**
 * Mandatory backup before every apply (§5.4): a zip in `.ai-vault-organizer/backups/` holding every
 * note, canvas and base file under `vault/` plus `manifest.json` with each file's size and
 * SHA-256. Restoring by hand means extracting `vault/` over the vault (see README).
 */
export class BackupService {
  constructor(private readonly deps: BackupDeps) {}

  async create(options: BackupOptions): Promise<BackupResult> {
    const { reader, hasher, storage, clock } = this.deps;
    const snapshot = await reader.snapshot();
    const paths = [
      ...snapshot.notes.map((note) => note.path),
      ...snapshot.otherFiles
        .filter((file) => options.includeAttachments || TEXT_EXTENSIONS.has(file.extension))
        .map((file) => file.path),
    ].sort();

    const entries: Zippable = {};
    const files: BackupManifest['files'] = [];
    for (const path of paths) {
      const data = await reader.readBinary(path);
      entries[`vault/${path}`] = data;
      files.push({ path, size: data.length, sha256: await hasher.sha256(data) });
    }
    const createdAt = new Date(clock.now()).toISOString();
    const manifest: BackupManifest = {
      version: 1,
      createdAt,
      planId: options.planId ?? null,
      pluginVersion: options.pluginVersion,
      includesAttachments: options.includeAttachments ?? false,
      files,
    };
    entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));

    const archive = await this.compress(entries);
    const stamp = createdAt.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const key = `${PREFIX}${stamp}-${sanitize(options.planId ?? 'manual')}.zip`;
    await storage.write(key, archive);
    return { key, manifest, bytes: archive.length };
  }

  /** Backup keys, newest first. Only files this service created are listed. */
  async list(): Promise<string[]> {
    return (await this.deps.storage.list(PREFIX)).filter((key) => BACKUP_NAME.test(key)).sort().reverse();
  }

  /** Deletes all but the newest `keep` backups; returns the removed keys. */
  async prune(keep: number): Promise<string[]> {
    const stale = (await this.list()).slice(Math.max(0, keep));
    for (const key of stale) await this.deps.storage.remove(key);
    return stale;
  }

  /** Unpacks and checks a backup: every file must match the manifest's hash. */
  async inspect(key: string): Promise<{ manifest: BackupManifest; files: Map<string, Uint8Array>; intact: boolean }> {
    const archive = await this.deps.storage.read(key);
    if (!archive) throw new Error(`No backup ${key}`);
    const unzipped = unzipSync(archive);
    const manifestBytes = unzipped['manifest.json'];
    if (!manifestBytes) throw new Error(`Backup ${key} has no manifest`);
    const manifest = backupManifestSchema.parse(JSON.parse(strFromU8(manifestBytes)));
    const files = new Map<string, Uint8Array>();
    let intact = true;
    for (const entry of manifest.files) {
      const data = unzipped[`vault/${entry.path}`];
      if (!data || (await this.deps.hasher.sha256(data)) !== entry.sha256) intact = false;
      if (data) files.set(entry.path, data);
    }
    return { manifest, files, intact };
  }

  /** Compresses off the main thread when workers are available, synchronously otherwise. */
  private compress(entries: Zippable): Promise<Uint8Array> {
    return new Promise((resolve) => {
      try {
        zip(entries, { level: 6 }, (error, data) => {
          if (error) {
            this.deps.logger.warn('Async zip failed; falling back to synchronous compression', error.message);
            resolve(zipSync(entries, { level: 6 }));
          } else {
            resolve(data);
          }
        });
      } catch (error) {
        this.deps.logger.warn('Async zip unavailable; compressing synchronously', error);
        resolve(zipSync(entries, { level: 6 }));
      }
    });
  }
}

function sanitize(text: string): string {
  return text.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'manual';
}
