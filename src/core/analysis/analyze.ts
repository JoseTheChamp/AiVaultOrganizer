import type { VaultSnapshot } from '../model/note';
import { computeHealth, type HealthOptions, type HealthReport } from './health';
import { detectMethods, type MethodDetection } from './method-detect';
import { computeStats, type VaultStats } from './stats';
import { triageNotes, type Triage } from './triage';

export interface VaultAnalysis {
  stats: VaultStats;
  methods: MethodDetection;
  health: HealthReport;
  triage: Triage;
}

/** Tier 0 diagnostics: everything the "Analyze vault" command shows, computed in one pass. */
export function analyzeVault(snapshot: VaultSnapshot, options: HealthOptions): VaultAnalysis {
  const stats = computeStats(snapshot);
  const methods = detectMethods(snapshot, stats);
  const health = computeHealth(snapshot, stats, methods, options);
  return { stats, methods, health, triage: triageNotes(snapshot.notes) };
}
