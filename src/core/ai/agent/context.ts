import type { VaultAnalysis } from '../../analysis/analyze';
import type { Clustering } from '../../analysis/clusters';
import { clusterKeywords } from '../../analysis/keywords';
import type { Lang } from '../../charter/presets';
import { prepareNote, preparedText } from '../../embeddings/prepare';
import type { VaultSnapshot } from '../../model/note';
import { isPrivateNote } from '../../model/privacy';
import { buildCard, type NoteCard } from '../../planner/cards';
import type { StageEstimate } from '../../planner/llm-stage';
import { estimateRequest } from '../budget';
import { charterAgentV1 } from '../prompts/charter-agent.v1';
import { type AgentCluster, type AgentContext, type AgentOptions, DEFAULT_AGENT } from './charter-agent';

export interface AgentContextInput {
  analysis: VaultAnalysis;
  snapshot: VaultSnapshot;
  /** Groups of similar notes (word statistics are enough; no model needed). */
  clustering: Clustering;
  read: (path: string) => Promise<string>;
  language: Lang;
  now: number;
}

/** The largest groups the agent can look at; small ones say little about a system. */
const MAX_CLUSTERS = 20;
/** Cards per group the agent can ask for. */
const SAMPLES = 5;
/** Notes per group read for its keywords. */
const KEYWORD_NOTES = 40;

/**
 * What the drafting agent can read (PLAN §7.7): the analysis and the largest groups of similar
 * notes, each with keywords and a few note cards. Private notes contribute neither cards nor
 * keywords, since keywords would carry their words to the model.
 */
export async function agentContext(input: AgentContextInput): Promise<{ context: AgentContext; withheld: number }> {
  const notes = new Map(input.snapshot.notes.map((note) => [note.path, note]));
  const isPrivate = (path: string) => {
    const note = notes.get(path);
    return !note || isPrivateNote(note.frontmatter);
  };
  const clusters = [...input.clustering.clusters].sort((a, b) => b.members.length - a.members.length || a.id - b.id).slice(0, MAX_CLUSTERS);
  const withheld = new Set<string>();
  const texts = new Map<string, string>();
  const contents = new Map<string, string>();
  for (const cluster of clusters) {
    for (const path of cluster.members.slice(0, KEYWORD_NOTES)) {
      if (isPrivate(path)) {
        withheld.add(path);
        continue;
      }
      const content = await input.read(path);
      contents.set(path, content);
      texts.set(path, preparedText(prepareNote(content, notes.get(path)?.basename ?? path)));
    }
  }
  const keywords = new Map(clusterKeywords(clusters, texts).map((entry) => [entry.id, entry.keywords]));
  const agentClusters: AgentCluster[] = clusters.map((cluster) => {
    const words = keywords.get(cluster.id) ?? [];
    const samples: NoteCard[] = [];
    for (const path of cluster.members) {
      if (samples.length >= SAMPLES) break;
      const note = notes.get(path);
      const content = contents.get(path);
      if (!note || content === undefined) continue;
      const card = buildCard(note, content, undefined, { now: input.now });
      if (card) samples.push(card);
    }
    return { id: cluster.id, label: words.slice(0, 3).join(', ') || `Group ${cluster.id}`, keywords: words, samples, size: cluster.members.length };
  });
  return { context: { analysis: input.analysis, language: input.language, clusters: agentClusters }, withheld: withheld.size };
}

/**
 * The agent's cost before it runs: the first request (instructions and tools) is known; how many
 * steps follow is not, so the upper bound is the agent's own token budget, at which it stops.
 */
export function estimateAgentRun(context: AgentContext, withheld: number, options: AgentOptions = DEFAULT_AGENT): StageEstimate {
  const first = estimateRequest({ messages: charterAgentV1.build({ language: context.language, wish: '' }), tools: charterAgentV1.tools }).input;
  const outputMax = Math.min(options.maxSteps * 750, Math.floor(options.maxTokens / 4));
  return {
    notes: context.clusters.reduce((sum, cluster) => sum + cluster.samples.length, 0),
    withheld,
    calls: { min: 2, max: options.maxSteps },
    inputTokens: { min: first * 2, max: options.maxTokens - outputMax },
    outputTokens: { min: 400, max: outputMax },
  };
}
