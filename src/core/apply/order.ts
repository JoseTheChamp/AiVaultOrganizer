import { type Operation, PHASE } from '../model/operation';

/**
 * Execution order shared by the validator and the executor: by phase, then by declared
 * dependencies (topologically) within a phase, then by position in the plan. Dependencies that
 * cannot be honored (cycles, unknown ids) are reported by the validator; here they are ignored so
 * ordering itself never fails.
 */
export function orderOperations(operations: readonly Operation[]): Operation[] {
  const index = new Map(operations.map((op, i) => [op.id, i]));
  const byPhase = new Map<number, Operation[]>();
  for (const op of operations) {
    const list = byPhase.get(PHASE[op.kind]) ?? [];
    list.push(op);
    byPhase.set(PHASE[op.kind], list);
  }

  const result: Operation[] = [];
  for (const phase of [...byPhase.keys()].sort((a, b) => a - b)) {
    const ops = byPhase.get(phase) ?? [];
    const ids = new Set(ops.map((op) => op.id));
    const pending = new Map(ops.map((op) => [op.id, (op.dependsOn ?? []).filter((dep) => ids.has(dep) && dep !== op.id)]));
    const done = new Set<string>();
    while (pending.size > 0) {
      const ready = ops.filter((op) => pending.has(op.id) && (pending.get(op.id) ?? []).every((dep) => done.has(dep)));
      // A cycle: fall back to plan order for the rest; the validator reports it.
      const next = ready.length > 0 ? ready : ops.filter((op) => pending.has(op.id));
      next.sort((a, b) => (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0));
      const op = next[0];
      if (!op) break;
      pending.delete(op.id);
      done.add(op.id);
      result.push(op);
    }
  }
  return result;
}
