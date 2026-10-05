import { err, type Result } from '../model/result';
import { parsePlan, type Plan } from '../model/plan';
import type { StoragePort } from '../ports';

const PREFIX = 'plans/';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Pending plans as JSON files in `.ai-vault-organizer/plans/`, validated on every load. */
export class PlanStore {
  constructor(private readonly storage: StoragePort) {}

  static key(planId: string): string {
    return `${PREFIX}${planId.replace(/[^\w.-]+/g, '-')}.json`;
  }

  async save(plan: Plan): Promise<string> {
    const key = PlanStore.key(plan.id);
    await this.storage.write(key, encoder.encode(`${JSON.stringify(plan, null, 2)}\n`));
    return key;
  }

  async load(planId: string): Promise<Result<Plan, string[]>> {
    return this.loadKey(PlanStore.key(planId));
  }

  /** The most recently created plan that parses; broken files are skipped, not fatal. */
  async latest(): Promise<Plan | null> {
    let newest: Plan | null = null;
    for (const key of await this.storage.list(PREFIX)) {
      if (!key.endsWith('.json')) continue;
      const loaded = await this.loadKey(key);
      if (loaded.ok && (newest === null || loaded.value.createdAt > newest.createdAt)) newest = loaded.value;
    }
    return newest;
  }

  private async loadKey(key: string): Promise<Result<Plan, string[]>> {
    const data = await this.storage.read(key);
    if (!data) return err([`No plan file ${key}`]);
    try {
      return parsePlan(JSON.parse(decoder.decode(data)));
    } catch {
      return err([`${key} is not valid JSON`]);
    }
  }
}
