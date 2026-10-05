import type { App } from 'obsidian';
import { BackupService } from '../core/apply/backup';
import { Journal } from '../core/apply/journal';
import { PlanStore } from '../core/apply/plan-store';
import { ApplyRunService } from '../core/apply/run';
import { UndoService } from '../core/apply/undo';
import { webCryptoHasher } from '../core/hash';
import { type Clock, type Hasher, type LinkIndex, type Logger, type StoragePort, systemClock, type VaultReader } from '../core/ports';
import { ObsidianLinkIndex } from './adapters/obsidian-link-index';
import { ObsidianStorage } from './adapters/obsidian-storage';
import { ObsidianVaultReader } from './adapters/obsidian-vault-reader';
import { ObsidianVaultWriter } from './adapters/obsidian-vault-writer';

/** Adapters and core services wired once per plugin load; commands and views use these. */
export interface PluginServices {
  reader: VaultReader;
  links: LinkIndex;
  storage: StoragePort;
  hasher: Hasher;
  clock: Clock;
  logger: Logger;
  journal: Journal;
  plans: PlanStore;
  backups: BackupService;
  runs: ApplyRunService;
  undo: UndoService;
}

/**
 * Composition root. The writer is handed only to the services that make up the single write path
 * (apply runs and undo); nothing else in the plugin receives it.
 */
export function createServices(app: App, logger: Logger): PluginServices {
  const clock = systemClock;
  const hasher = webCryptoHasher;
  const reader = new ObsidianVaultReader(app, hasher, clock);
  const writer = new ObsidianVaultWriter(app);
  const links = new ObsidianLinkIndex(app);
  const storage = new ObsidianStorage(app.vault.adapter);
  const journal = new Journal(storage, clock);
  const base = { reader, writer, links, journal, hasher, logger, storage, clock };
  return {
    reader,
    links,
    storage,
    hasher,
    clock,
    logger,
    journal,
    plans: new PlanStore(storage),
    backups: new BackupService(base),
    runs: new ApplyRunService(base),
    undo: new UndoService(base),
  };
}
