import { ApplyExecutor } from '../apply/executor';
import { Journal } from '../apply/journal';
import { webCryptoHasher } from '../hash';
import { createOperation, type Operation, type OperationIntent } from '../model/operation';
import { createPlan, type Plan } from '../model/plan';
import { silentLogger } from '../ports';
import { InMemoryVault } from './in-memory-vault';
import { MemoryStorage } from './memory-storage';

/** Everything an apply/undo test needs, wired the way the plugin wires the real adapters. */
export function applyHarness(files: Record<string, string>, folders: string[] = []) {
  let now = Date.UTC(2026, 9, 5, 12, 0, 0);
  const clock = { now: () => (now += 1000) };
  const vault = InMemoryVault.from(files, { folders, clock });
  const storage = new MemoryStorage();
  const journal = new Journal(storage, clock);
  const deps = { reader: vault, writer: vault, links: vault, journal, hasher: webCryptoHasher, logger: silentLogger };
  const executor = new ApplyExecutor(deps);
  return { vault, storage, journal, executor, deps, clock };
}

export function acceptedOp(intent: OperationIntent, extra: Partial<Operation> = {}): Operation {
  return { ...createOperation(intent, { status: 'accepted' }), ...extra } as Operation;
}

export function planOf(operations: Operation[], id = 'plan-1'): Plan {
  return createPlan({ id, createdAt: '2026-10-05T12:00:00.000Z', operations });
}
