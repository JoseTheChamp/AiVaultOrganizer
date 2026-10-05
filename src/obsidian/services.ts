import type { App } from 'obsidian';
import { ResponseCache } from '../core/ai/cache';
import { type AiDeps, type ConnectionReport, createChatProvider, createEmbeddingProvider, testConnection } from '../core/ai/factory';
import type { RunBudget } from '../core/ai/budget';
import type { ChatProvider, EmbeddingProvider } from '../core/ai/types';
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
import { ObsidianSecrets, RequestUrlHttp, windowSleep } from './adapters/request-url-http';
import type { PluginSettings } from './settings/settings';

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
  ai: AiServices;
}

/** AI providers built from the settings at call time, so changes apply without a reload. */
export interface AiServices {
  chat(options?: { budget?: RunBudget; cache?: boolean }): ChatProvider | null;
  embeddings(): EmbeddingProvider | null;
  testConnection(purpose: 'chat' | 'embeddings'): Promise<ConnectionReport>;
  clearCache(): Promise<number>;
}

/**
 * Composition root. The writer is handed only to the services that make up the single write path
 * (apply runs and undo); nothing else in the plugin receives it.
 */
export function createServices(app: App, logger: Logger, settings: () => PluginSettings): PluginServices {
  const clock = systemClock;
  const hasher = webCryptoHasher;
  const reader = new ObsidianVaultReader(app, hasher, clock);
  const writer = new ObsidianVaultWriter(app);
  const links = new ObsidianLinkIndex(app);
  const storage = new ObsidianStorage(app.vault.adapter);
  const journal = new Journal(storage, clock);
  const base = { reader, writer, links, journal, hasher, logger, storage, clock };
  const aiDeps: AiDeps = { http: new RequestUrlHttp(), secrets: new ObsidianSecrets(app), storage, hasher, clock, sleep: windowSleep };
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
    ai: {
      chat: (options) => createChatProvider(settings().ai, aiDeps, options),
      embeddings: () => createEmbeddingProvider(settings().ai, aiDeps),
      testConnection: (purpose) => testConnection(purpose, settings().ai, aiDeps),
      clearCache: () => new ResponseCache(storage, hasher).clear(),
    },
  };
}
