import { labelClusters } from '../../src/core/analysis/cluster-labels';
import { type Clustering, clusterEmbeddings, clusterWords } from '../../src/core/analysis/clusters';
import { findDuplicates } from '../../src/core/analysis/duplicates';
import { clusterKeywords } from '../../src/core/analysis/keywords';
import { DEFAULT_CANDIDATES, type LinkCandidate, linkCandidates } from '../../src/core/analysis/link-candidates';
import { verifyLinks } from '../../src/core/analysis/link-verify';
import { triageNotes } from '../../src/core/analysis/triage';
import { ProviderError } from '../../src/core/ai/types';
import { EmbeddingIndex } from '../../src/core/embeddings/embedding-index';
import { prepareNote, preparedText } from '../../src/core/embeddings/prepare';
import { DenseSearch } from '../../src/core/embeddings/search';
import { countTerms, type TermCounts, TfidfModel } from '../../src/core/embeddings/tfidf';
import type { Neighbor } from '../../src/core/embeddings/top-k';
import { VectorStore } from '../../src/core/embeddings/vector-store';
import { webCryptoHasher } from '../../src/core/hash';
import type { VaultSnapshot } from '../../src/core/model/note';
import { parentFolder } from '../../src/core/model/paths';
import { buildCard, type NoteCard } from '../../src/core/planner/cards';
import { DEFAULT_KNN, WORD_KNN } from '../../src/core/planner/classify';
import { systemClock } from '../../src/core/ports';
import { NodeStorage } from '../adapters/node-storage';
import type { GroundTruth, LoadedFixture } from '../fixture/ground-truth';
import { ratio } from '../metrics/classification';
import { type ClusterMetrics, clusterMetrics } from '../metrics/clusters';
import { type Cost, NO_COST } from '../metrics/cost';
import { type DuplicateMetrics, duplicateMetrics } from '../metrics/duplicates';
import { type LinkMetrics, linkMetrics } from '../metrics/links';
import { type NeighborQuality, neighborQuality } from '../metrics/neighbors';
import { checkSummary, judgeSummary, type SummaryQuality } from './judge';
import { type ClassificationResults, classificationTask, type PlanMetrics, planTask } from './planning';
import { type EvalChat, evalChat, evalEmbeddings, Meter } from './providers';
import { applyAndUndo, type SafetyMetrics } from './safety';

export { STAGES } from './planning';
export type { ClassificationResults, PlanMetrics, Stage, StageMetrics } from './planning';
export type { SafetyMetrics } from './safety';
export type { SummaryQuality } from './judge';
export type Tier = 0 | 1 | 2;
export type SimilarityMethod = 'words' | 'embeddings';

export interface EvalOptions {
  tier: Tier;
  /** Call live models and store what they return; otherwise only stored vectors and cassettes are used. */
  record: boolean;
  embedModel: string;
  chatModel: string;
  /** Where the fixture's embedding index lives (committed for CI fixtures). */
  indexDir: string;
}

/** Clusters against two ground truths: the topic and the project, area or topic entity. */
export interface ClusterQuality {
  topic: ClusterMetrics;
  project: ClusterMetrics;
}

export interface LabelQuality {
  clusters: number;
  calls: number;
  failures: number;
  repaired: number;
  /** Each label with the most common topic among its cluster's notes, for reading the report. */
  examples: { label: string; topic: string; share: number }[];
}

export interface EvalResult {
  fixture: string;
  language: 'en' | 'cs';
  notes: number;
  tier: Tier;
  embedModel: string | null;
  chatModel: string | null;
  /** Per organizing method, the cascade measured stage by stage. */
  classification: ClassificationResults;
  /** Link suggestions: word statistics (Tier 0), embeddings (Tier 1), verified by a model (Tier 2). */
  links: Partial<Record<SimilarityMethod | 'verified', LinkMetrics>>;
  similarity: Partial<Record<SimilarityMethod, NeighborQuality>>;
  clusters: Partial<Record<'folders' | SimilarityMethod, ClusterQuality>>;
  duplicates: Partial<Record<SimilarityMethod, DuplicateMetrics>>;
  stubs: { found: number; actual: number; precision: number; recall: number };
  labels?: LabelQuality;
  /** The whole planner with a PARA charter, applied and undone. */
  plan: PlanMetrics;
  /** The plan's summary: its numbers checked by code and, at Tier 2, graded by a model judge. */
  summary: SummaryQuality;
  safety: SafetyMetrics;
  cost: Record<string, Cost>;
  /** What was skipped and why. */
  notices: string[];
}

/** Suggestions per note that are measured: the number verified at Tier 2, so tiers compare. */
const LINK_K = 3;
const TOPIC_K = 5;
/** Similarity floors for link candidates: word and embedding similarities live on different scales. */
const FLOOR: Record<SimilarityMethod, number> = { words: 0.1, embeddings: 0.5 };

type Search = (path: string, k: number, exclude: ReadonlySet<string>) => Neighbor[];

/** What a similarity method offers the analysis tasks. */
interface Method {
  name: SimilarityMethod;
  similarity: (a: string, b: string) => number;
  search: Search;
  clustering: Clustering;
}

/**
 * Runs every eval task that exists at the requested tier over one fixture (PLAN §8): Tier 0 is rules,
 * word statistics, MinHash and LSA clustering; Tier 1 adds embeddings; Tier 2 adds a language model
 * that labels clusters and verifies links. Each task is measured against the fixture's ground
 * truth with the metrics of §8.2, and its cost is recorded.
 */
export async function runEval(fixture: LoadedFixture, options: EvalOptions): Promise<EvalResult> {
  const { truth } = fixture;
  const snapshot = await fixture.vault.snapshot();
  const contents = new Map<string, string>();
  for (const note of snapshot.notes) contents.set(note.path, await fixture.vault.read(note.path));
  const notices: string[] = [];
  const cost: Record<string, Cost> = {};
  const time = async <T>(task: string, run: () => Promise<T> | T): Promise<T> => {
    const started = performance.now();
    const result = await run();
    cost[task] = { ...(cost[task] ?? NO_COST), ms: Math.round(performance.now() - started) };
    return result;
  };
  const isDaily = (path: string): boolean => truth.notes[path]?.kind === 'daily';
  const topics = new Map(Object.entries(truth.notes).map(([path, note]) => [path, note.topic]));
  const projects = new Map(Object.entries(truth.notes).map(([path, note]) => [path, note.entity]));
  const clusterQuality = (assignments: ReadonlyMap<string, string>): ClusterQuality => ({ topic: clusterMetrics(assignments, topics), project: clusterMetrics(assignments, projects) });

  const triage = triageNotes(snapshot.notes);
  const actualStubs = new Set(Object.entries(truth.notes).filter(([, note]) => note.isStub).map(([path]) => path));
  const foundStubs = triage.stubs.filter((stub) => actualStubs.has(stub.path)).length;
  const stubs = { found: triage.stubs.length, actual: actualStubs.size, precision: ratio(foundStubs, triage.stubs.length), recall: ratio(foundStubs, actualStubs.size) };

  const methods: Method[] = [await time('words', () => wordMethod(snapshot, contents))];
  if (options.tier >= 1) {
    const meter = new Meter();
    const embedded = await time('embeddings', () => embeddingMethod(snapshot, fixture, options, meter));
    cost.embeddings = { ...(cost.embeddings ?? NO_COST), calls: meter.calls, inputTokens: meter.inputTokens };
    if (typeof embedded === 'string') notices.push(embedded);
    else methods.push(embedded);
  }

  const links: EvalResult['links'] = {};
  const similarity: EvalResult['similarity'] = {};
  const duplicates: EvalResult['duplicates'] = {};
  const clusters: EvalResult['clusters'] = {
    // Baseline: the vault's current folders as clusters.
    folders: clusterQuality(new Map(snapshot.notes.map((note) => [note.path, parentFolder(note.path) || '/']))),
  };
  const duplicateInput = snapshot.notes.map((note) => ({ path: note.path, title: note.basename, text: bodyText(contents.get(note.path) ?? '', note.basename) }));
  const candidatesBy = new Map<SimilarityMethod, Map<string, LinkCandidate[]>>();
  const topicLabels = Object.fromEntries(topics);
  const languages = Object.fromEntries([...topics.keys()].map((path) => [path, truth.language]));
  for (const method of methods) {
    const candidates = await time(`${method.name} links`, () =>
      linkCandidates({ notes: snapshot.notes, similarity: method.similarity, clustering: method.clustering }, { ...DEFAULT_CANDIDATES, floor: FLOOR[method.name] }),
    );
    candidatesBy.set(method.name, candidates);
    links[method.name] = linkMetrics(new Map([...candidates].map(([path, list]) => [path, list.map((c) => c.target)])), truth, LINK_K, isDaily);
    similarity[method.name] = neighborQuality(new Map(snapshot.notes.map((note) => [note.path, method.search(note.path, TOPIC_K, new Set()).map((n) => n.path)])), topicLabels, languages, TOPIC_K);
    clusters[method.name] = clusterQuality(new Map([...method.clustering.assignments].map(([path, id]) => [path, String(id)])));
    const neighbors = method.name === 'embeddings' ? (path: string) => method.search(path, 3, new Set()) : undefined;
    duplicates[method.name] = duplicateMetrics(findDuplicates(duplicateInput, neighbors).map((pair) => [pair.a, pair.b] as [string, string]), truth);
  }

  const best = methods.at(-1) as Method;
  const meter = new Meter();
  let chat: EvalChat | undefined;
  // Tier 2 tasks whose prompts the cassette has no answers for; they are reported, not guessed.
  const unrecorded: string[] = [];
  /** Times a task and counts its model calls; with `record`, saves the cassette after each task. */
  const withModel = async <T>(task: string, run: () => Promise<T>): Promise<{ value: T; recorded: boolean }> => {
    const before = { ...meter };
    const value = await time(task, run);
    cost[task] = { ...(cost[task] ?? NO_COST), calls: meter.calls - before.calls, inputTokens: meter.inputTokens - before.inputTokens, outputTokens: meter.outputTokens - before.outputTokens };
    await chat?.finish();
    const recorded = meter.missing === before.missing;
    if (!recorded) unrecorded.push(task);
    return { value, recorded };
  };

  let labels: LabelQuality | undefined;
  if (options.tier >= 2) {
    chat = await evalChat(truth.fixture, options.chatModel, options.record, meter);
    const provider = chat.provider;
    const cards = new Map<string, NoteCard>();
    for (const note of snapshot.notes) {
      const card = buildCard(note, contents.get(note.path) ?? '');
      if (card) cards.set(note.path, card);
    }
    const missing = meter.missing;
    try {
      const named = await withModel('cluster labels', () => labelQuality(provider, truth, best.clustering, contents, cards, topics));
      if (named.recorded) labels = named.value;
    } catch (error) {
      // Labeling gives up when every batch failed, which is what a cassette without answers causes.
      if (!(error instanceof ProviderError) || meter.missing === missing) throw error;
      unrecorded.push('cluster labels');
    }
    const verified = await withModel('verified links', () => verifyLinks(provider, truth.language, candidatesBy.get(best.name) ?? new Map(), cards));
    if (verified.recorded) {
      const kept = new Map<string, string[]>();
      for (const candidate of verified.value.kept) kept.set(candidate.source, [...(kept.get(candidate.source) ?? []), candidate.target]);
      links.verified = linkMetrics(kept, truth, LINK_K, isDaily);
    }
  }

  const neighbors = (method: Method) => (path: string, k: number) => method.search(path, k, new Set());
  const embeddings = methods.find((method) => method.name === 'embeddings');
  const classified = await withModel('classification', () =>
    classificationTask({ snapshot, truth, contents, words: neighbors(methods[0] as Method), ...(embeddings ? { embeddings: neighbors(embeddings) } : {}), ...(chat ? { chat: chat.provider } : {}) }),
  );
  const classification = classified.value;
  // A stage that ran without its recorded answers measures nothing; leave it out.
  if (!classified.recorded) for (const stages of Object.values(classification)) delete stages.llm;
  const planInput = { snapshot, truth, contents, neighbors: neighbors(best), knn: best.name === 'embeddings' ? DEFAULT_KNN : WORD_KNN };
  let planned = (await withModel('plan', () => planTask({ ...planInput, ...(chat ? { chat: chat.provider } : {}) }))).value;
  if (unrecorded.includes('plan')) planned = await planTask(planInput);
  const plan = planned.metrics;
  if (chat) {
    // What the user pays for; the judge below is the eval's own cost, reported on its own.
    cost.chat = { calls: meter.calls, inputTokens: meter.inputTokens, outputTokens: meter.outputTokens, ms: ['cluster labels', 'verified links', 'classification', 'plan'].reduce((sum, task) => sum + (cost[task]?.ms ?? 0), 0) };
  }
  let summary = checkSummary(planned.summary, planned.facts);
  if (chat && !unrecorded.includes('plan')) {
    const provider = chat.provider;
    const missing = meter.missing;
    try {
      const judged = await withModel('summary judge', () => judgeSummary(provider, planned.summary, planned.facts));
      if (judged.recorded) summary = { ...summary, ...judged.value };
    } catch (error) {
      if (!(error instanceof ProviderError) || meter.missing === missing) throw error;
      unrecorded.push('summary judge');
    }
  }
  if (unrecorded.length > 0) {
    notices.push(`Tier 2 incomplete for ${truth.fixture}: no recorded ${options.chatModel} answers for ${unrecorded.join(', ')}; run with --record against a local Ollama.`);
  }

  const safety = await time('safety', () => applyAndUndo(snapshot, contents, truth));
  return {
    fixture: truth.fixture,
    language: truth.language,
    notes: snapshot.notes.length,
    tier: options.tier,
    embedModel: options.tier >= 1 ? options.embedModel : null,
    chatModel: options.tier >= 2 ? options.chatModel : null,
    classification,
    links,
    similarity,
    clusters,
    duplicates,
    stubs,
    ...(labels ? { labels } : {}),
    plan,
    summary,
    safety,
    cost,
    notices,
  };
}

function bodyText(content: string, title: string): string {
  return prepareNote(content, title)
    .sections.flatMap((section) => section.paragraphs)
    .join('\n');
}

function wordMethod(snapshot: VaultSnapshot, contents: ReadonlyMap<string, string>): Method {
  const documents = new Map<string, TermCounts>();
  for (const note of snapshot.notes) documents.set(note.path, countTerms(prepareNote(contents.get(note.path) ?? '', note.basename), note.tags));
  const model = TfidfModel.build(documents);
  return {
    name: 'words',
    similarity: (a, b) => model.similarity(a, b),
    search: (path, k, exclude) => model.similar(path, k, exclude),
    clustering: clusterWords(model),
  };
}

/**
 * Tier 1 over the fixture's embedding index. Replay (the default) only reads stored vectors, so
 * evals stay offline and free; `record` embeds whatever is missing with a live Ollama model.
 * Returns a notice instead when vectors are missing.
 */
async function embeddingMethod(snapshot: VaultSnapshot, fixture: LoadedFixture, options: EvalOptions, meter: Meter): Promise<Method | string> {
  const index = new EmbeddingIndex(evalEmbeddings(options.embedModel, options.record, meter), new VectorStore(new NodeStorage(options.indexDir), webCryptoHasher), systemClock);
  try {
    await index.update(snapshot.notes, (path) => fixture.vault.read(path));
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    const hint = options.record ? `embedding failed: ${error.message}` : `no stored ${options.embedModel} vectors for every note; run with --record against a local Ollama`;
    return `Tier 1 skipped for ${fixture.name}: ${hint}.`;
  }
  const set = await index.vectors();
  if (!set) return `Tier 1 skipped for ${fixture.name}: no vectors.`;
  const { paths, matrix } = set.toMatrix();
  const search = new DenseSearch({ paths, dims: set.dims, matrix });
  return {
    name: 'embeddings',
    similarity: (a, b) => search.similarity(a, b),
    search: (path, k, exclude) => search.similar(path, k, exclude),
    clustering: clusterEmbeddings(paths, matrix, set.dims),
  };
}

async function labelQuality(
  provider: Parameters<typeof labelClusters>[0],
  truth: GroundTruth,
  clustering: Clustering,
  contents: ReadonlyMap<string, string>,
  cards: ReadonlyMap<string, NoteCard>,
  topics: ReadonlyMap<string, string>,
): Promise<LabelQuality> {
  const texts = new Map([...contents].map(([path, content]) => [path, preparedText(prepareNote(content, path.slice(path.lastIndexOf('/') + 1, -3)))]));
  const keywords = new Map(clusterKeywords(clustering.clusters, texts).map((k) => [k.id, k.keywords]));
  const report = await labelClusters(
    provider,
    truth.language,
    clustering.clusters.map((cluster) => ({
      id: cluster.id,
      keywords: keywords.get(cluster.id) ?? [],
      samples: cluster.members.flatMap((path) => cards.get(path) ?? []).slice(0, 5),
    })),
  );
  if (report.failures > 0 && report.labels.every((label) => label.source === 'keywords')) throw new ProviderError('invalid-response', 'every label batch failed');
  return {
    clusters: clustering.clusters.length,
    calls: report.calls,
    failures: report.failures,
    repaired: report.repaired,
    examples: report.labels.map((label) => {
      const members = clustering.clusters.find((cluster) => cluster.id === label.id)?.members ?? [];
      const counts = new Map<string, number>();
      for (const path of members) counts.set(topics.get(path) ?? '?', (counts.get(topics.get(path) ?? '?') ?? 0) + 1);
      const [topic, count] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] ?? ['?', 0];
      return { label: label.label, topic, share: ratio(count, members.length) };
    }),
  };
}
