import type { EndpointSetting } from '../../core/ai/settings';
import { hostOf, isLoopbackUrl } from '../../core/ai/endpoint-url';
import { analyzeVault } from '../../core/analysis/analyze';
import type { JournalRun, RunStatus } from '../../core/apply/journal';
import type { CharterLoad } from '../../core/charter/load';
import { computeDrift } from '../../core/drift/drift';
import { METHOD_LABELS } from '../../core/model/methods';
import type { VaultSnapshot } from '../../core/model/note';
import type { Plan } from '../../core/model/plan';

export interface DashboardInput {
  snapshot: VaultSnapshot;
  charter: CharterLoad;
  /** The newest run in the journal, undone or not. */
  lastRun: JournalRun | null;
  /** Whether a run can be undone (the newest one that changed something and is not undone yet). */
  canUndo: boolean;
  pendingPlan: Plan | null;
  ai: { chat: EndpointSetting; embeddings: EndpointSetting };
  now: number;
}

export type CharterStatus =
  | { status: 'missing'; path: string }
  | { status: 'not-a-charter'; path: string }
  | { status: 'invalid'; path: string; problems: number }
  | { status: 'ok'; path: string; method: string; revision: number };

export interface ModelStatus {
  /** "qwen3:8b", or null when this kind of model is off. */
  model: string | null;
  /** "this computer" or the host notes go to. */
  where: string;
  local: boolean;
}

export interface DashboardState {
  health: { score: number; grade: 'good' | 'fair' | 'poor'; notes: number };
  charter: CharterStatus;
  /** Null without a valid charter. */
  drift: { offCharter: number; notes: number; missingFolders: number } | null;
  /** Operations still waiting for a decision or an apply. */
  pending: { planId: string; open: number } | null;
  lastRun: { at: string; status: RunStatus | 'running'; applied: number; undone: boolean } | null;
  canUndo: boolean;
  chat: ModelStatus;
  embeddings: ModelStatus;
}

/** What the dashboard view holds; the component re-renders when it changes. */
export interface DashboardModel {
  /** Null while loading. */
  state: DashboardState | null;
  error: string | null;
  /** True while a run changes the vault; actions that change it wait. */
  busy: boolean;
}

/** What the dashboard's buttons do; the view wires them to the plugin's flows. */
export interface DashboardActions {
  refresh: () => void;
  analyze: () => void;
  setUp: () => void;
  openCharter: () => void;
  plan: () => void;
  review: () => void;
  undo: () => void;
}

/** Everything the dashboard shows, from data the plugin already has (Tier 0, no model calls). */
export function dashboardState(input: DashboardInput): DashboardState {
  const { charter, snapshot } = input;
  const valid = charter.status === 'ok' ? charter.charter : null;
  const analysis = analyzeVault(snapshot, { now: input.now, ...(valid?.inbox ? { inboxFolder: valid.inbox, inboxMaxAgeDays: valid.drift.inboxMaxAgeDays } : {}) });
  const drift = valid ? computeDrift(snapshot, valid, { charterPath: charter.path, now: input.now }) : null;
  const open = input.pendingPlan?.operations.filter((op) => op.status === 'pending' || op.status === 'accepted').length ?? 0;
  const run = input.lastRun;
  return {
    health: { score: analysis.health.score, grade: analysis.health.grade, notes: snapshot.notes.length },
    charter: charterStatus(charter),
    drift: drift ? { offCharter: drift.offCharter, notes: drift.noteCount, missingFolders: drift.missingFolders.length } : null,
    pending: input.pendingPlan && open > 0 ? { planId: input.pendingPlan.id, open } : null,
    lastRun: run ? { at: run.end?.finishedAt ?? run.run.startedAt, status: run.end?.status ?? 'running', applied: run.end?.applied ?? run.ops.length, undone: run.undo !== null } : null,
    canUndo: input.canUndo,
    chat: modelStatus(input.ai.chat),
    embeddings: modelStatus(input.ai.embeddings),
  };
}

function charterStatus(load: CharterLoad): CharterStatus {
  switch (load.status) {
    case 'missing':
      return { status: 'missing', path: load.path };
    case 'no-block':
      return { status: 'not-a-charter', path: load.path };
    case 'invalid':
      return { status: 'invalid', path: load.path, problems: load.issues.length };
    case 'ok':
      return {
        status: 'ok',
        path: load.path,
        method: load.charter.preset === 'custom' ? 'Custom' : METHOD_LABELS[load.charter.preset],
        revision: load.charter.revision,
      };
  }
}

function modelStatus(setting: EndpointSetting): ModelStatus {
  const local = isLoopbackUrl(setting.baseUrl);
  return { model: setting.enabled && setting.model ? setting.model : null, where: local ? 'this computer' : hostOf(setting.baseUrl), local };
}
