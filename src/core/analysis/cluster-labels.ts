import { type ClusterLabelInput, clusterLabelV1 } from '../ai/prompts/cluster-label.v1';
import { runPrompt } from '../ai/prompts/types';
import type { ChatProvider } from '../ai/types';
import type { NoteCard } from '../planner/cards';

export interface LabelRequest {
  id: number;
  keywords: string[];
  /** Representative notes; callers pass cards only for notes that may go to a model. */
  samples: NoteCard[];
}

export interface ClusterLabel {
  id: number;
  label: string;
  description: string;
  /** Whether a model named the cluster, or its keywords stand in after a failure. */
  source: 'model' | 'keywords';
}

export interface LabelReport {
  labels: ClusterLabel[];
  calls: number;
  /** Batches whose answer stayed invalid after the repair round, or failed outright. */
  failures: number;
  /** Batches that needed a repair round. */
  repaired: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Names clusters with a language model (Tier 2, PLAN §7.4), a few clusters per call. A batch that
 * fails falls back to its clusters' top keywords, so every cluster always has a name and the
 * failure is counted, never hidden.
 */
export async function labelClusters(provider: ChatProvider, language: 'en' | 'cs', requests: readonly LabelRequest[], batchSize = 6): Promise<LabelReport> {
  const report: LabelReport = { labels: [], calls: 0, failures: 0, repaired: 0, inputTokens: 0, outputTokens: 0 };
  for (let start = 0; start < requests.length; start += batchSize) {
    const batch = requests.slice(start, start + batchSize);
    const input: ClusterLabelInput = {
      language,
      groups: batch.map((request, i) => ({ id: `g${i + 1}`, keywords: request.keywords, samples: request.samples })),
    };
    const result = await runPrompt(provider, clusterLabelV1, input);
    report.calls += result.ok ? result.value.attempts : result.error.attempts;
    if (result.ok) {
      if (result.value.repaired) report.repaired++;
      report.inputTokens += result.value.response.usage.inputTokens;
      report.outputTokens += result.value.response.usage.outputTokens;
      const byGroup = new Map(result.value.value.labels.map((label) => [label.groupId, label]));
      batch.forEach((request, i) => {
        const label = byGroup.get(`g${i + 1}`);
        report.labels.push(label ? { id: request.id, label: label.label, description: label.description, source: 'model' } : fallback(request));
      });
    } else {
      report.failures++;
      report.labels.push(...batch.map(fallback));
    }
  }
  return report;
}

function fallback(request: LabelRequest): ClusterLabel {
  return { id: request.id, label: request.keywords.slice(0, 3).join(', ') || `Group ${request.id + 1}`, description: '', source: 'keywords' };
}
