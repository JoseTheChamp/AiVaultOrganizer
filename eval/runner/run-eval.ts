import { configFromPreset, findPreset } from '../../src/core/ai/config';
import { OpenAICompatibleClient } from '../../src/core/ai/openai-compatible';
import { type EmbeddingProvider, type EmbeddingResponse, ProviderError } from '../../src/core/ai/types';
import { ApplyRunService } from '../../src/core/apply/run';
import { UndoService } from '../../src/core/apply/undo';
import { presetCharter } from '../../src/core/charter/presets';
import { RuleEngine } from '../../src/core/drift/rules';
import { EmbeddingIndex } from '../../src/core/embeddings/embedding-index';
import { prepareNote } from '../../src/core/embeddings/prepare';
import { DenseSearch } from '../../src/core/embeddings/search';
import { countTerms, type TermCounts, TfidfModel } from '../../src/core/embeddings/tfidf';
import type { Neighbor } from '../../src/core/embeddings/top-k';
import { VectorStore } from '../../src/core/embeddings/vector-store';
import { webCryptoHasher } from '../../src/core/hash';
import type { NoteRecord, VaultSnapshot } from '../../src/core/model/note';
import { createOperation, type Operation } from '../../src/core/model/operation';
import { ancestorFolders, parentFolder } from '../../src/core/model/paths';
import { createPlan } from '../../src/core/model/plan';
import { systemClock } from '../../src/core/ports';
import { applyHarness } from '../../src/core/testing/apply-harness';
import { FakeSecrets } from '../../src/core/testing/fake-http';
import { FetchHttp } from '../adapters/fetch-http';
import { NodeStorage } from '../adapters/node-storage';
import { DAILY, FIXTURE_METHOD_KEYS, FIXTURE_METHODS, type FixtureMethod, type GroundTruth, type LoadedFixture, pairKey } from '../fixture/ground-truth';
import { type ClassificationMetrics, classificationMetrics, type Prediction } from '../metrics/classification';
import { type ClusterMetrics, clusterMetrics } from '../metrics/clusters';
import { type Cost, NO_COST } from '../metrics/cost';
import { type DuplicateMetrics, duplicateMetrics } from '../metrics/duplicates';
import { type LinkMetrics, linkMetrics } from '../metrics/links';
import { type NeighborQuality, neighborQuality } from '../metrics/neighbors';

export type Tier = 0 | 1 | 2;
export type SimilarityMethod = 'words' | 'embeddings';

export interface EvalOptions {
  tier: Tier;
  /** Embed with a live model and store the vectors; otherwise only stored vectors are used. */
  record: boolean;
  embedModel: string;
  /** Where the fixture's embedding index lives (committed for CI fixtures). */
  indexDir: string;
}

export interface SafetyMetrics {
  /** Moves in the plan that files every note where PARA says it belongs. */
  operations: number;
  applied: number;
  failed: number;
  /** Links that no longer resolve after applying (must be 0). */
  brokenLinks: number;
  /** Whether undo restored every byte and folder (must be true). */
  undoExact: boolean;
}

export interface EvalResult {
  fixture: string;
  language: 'en' | 'cs';
  notes: number;
  tier: Tier;
  embedModel: string | null;
  classification: Record<FixtureMethod, ClassificationMetrics>;
  links: Partial<Record<SimilarityMethod, LinkMetrics>>;
  similarity: Partial<Record<SimilarityMethod, NeighborQuality>>;
  clusters: Record<string, ClusterMetrics>;
  duplicates: Partial<Record<SimilarityMethod, DuplicateMetrics & { threshold: number }>>;
  safety: SafetyMetrics;
  cost: Record<string, Cost>;
  /** What was skipped and why. */
  notices: string[];
}

const K = 5;
/**
 * Baseline duplicate detectors until M7 adds MinHash and title checks: a nearest neighbour at least
 * this similar is called a duplicate (0.92 for embeddings is the PLAN §7.4 value).
 */
const DUPLICATE_THRESHOLD: Record<SimilarityMethod, number> = { words: 0.8, embeddings: 0.92 };

type Search = (path: string, k: number, exclude: ReadonlySet<string>) => Neighbor[];

/**
 * Runs every eval task that exists at the requested tier over one fixture (PLAN §8): Tier 0 is
 * rules and word statistics, Tier 1 adds embeddings, Tier 2 adds language-model tasks (none yet).
 * Each task is measured against the fixture's ground truth with the metrics of §8.2.
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

  const classification = await time('classification', () => classifyByRules(snapshot, truth));
  const searches: Partial<Record<SimilarityMethod, Search>> = {};
  searches.words = await time('words', () => wordSearch(snapshot, contents));
  if (options.tier >= 1) {
    const embedded = await time('embeddings', () => embeddingSearch(snapshot, fixture, options));
    if (embedded.search) searches.embeddings = embedded.search;
    else notices.push(embedded.notice);
    cost.embeddings = { ...(cost.embeddings ?? NO_COST), calls: embedded.calls, inputTokens: embedded.tokens };
  }
  if (options.tier >= 2) notices.push('Tier 2 has no tasks yet: cluster labels and link verification arrive in M7, classification in M8.');

  const links: EvalResult['links'] = {};
  const similarity: EvalResult['similarity'] = {};
  const duplicates: EvalResult['duplicates'] = {};
  const topics = Object.fromEntries(Object.entries(truth.notes).map(([path, note]) => [path, note.topic]));
  const languages = Object.fromEntries(Object.keys(truth.notes).map((path) => [path, truth.language]));
  for (const [method, search] of Object.entries(searches) as [SimilarityMethod, Search][]) {
    links[method] = linkMetrics(suggestLinks(snapshot, search), truth, K);
    similarity[method] = neighborQuality(new Map(snapshot.notes.map((note) => [note.path, search(note.path, K, new Set()).map((n) => n.path)])), topics, languages, K);
    const threshold = DUPLICATE_THRESHOLD[method];
    duplicates[method] = { ...duplicateMetrics(duplicatePairs(snapshot, search, threshold), truth), threshold };
  }

  const clusters = {
    // Baseline until clustering exists (M7): the vault's current folders as clusters.
    folders: clusterMetrics(new Map(snapshot.notes.map((note) => [note.path, parentFolder(note.path) || '/'])), new Map(Object.entries(topics))),
  };
  const safety = await time('safety', () => applyAndUndo(snapshot, contents, truth));

  return {
    fixture: truth.fixture,
    language: truth.language,
    notes: snapshot.notes.length,
    tier: options.tier,
    embedModel: options.tier >= 1 ? options.embedModel : null,
    classification,
    links,
    similarity,
    clusters,
    duplicates,
    safety,
    cost,
    notices,
  };
}

/** Tier 0 classification: what the preset charters' rules alone decide; everything else abstains. */
function classifyByRules(snapshot: VaultSnapshot, truth: GroundTruth): Record<FixtureMethod, ClassificationMetrics> {
  const result = {} as Record<FixtureMethod, ClassificationMetrics>;
  for (const method of FIXTURE_METHOD_KEYS) {
    const engine = new RuleEngine(presetCharter(FIXTURE_METHODS[method], truth.language));
    const predictions: Prediction[] = snapshot.notes.map((note) => {
      const placement = engine.evaluate(note);
      if (placement.status === 'ruled') return { path: note.path, destination: placement.destination.id, confidence: 1, decidedBy: 'rules' };
      if (placement.status === 'system' && placement.role === 'daily') return { path: note.path, destination: DAILY, confidence: 1, decidedBy: 'rules' };
      return { path: note.path, destination: null, confidence: 0, decidedBy: null };
    });
    const expected = new Map(Object.entries(truth.notes).map(([path, note]) => [path, note.destinations[method].id]));
    result[method] = classificationMetrics(predictions, expected);
  }
  return result;
}

function wordSearch(snapshot: VaultSnapshot, contents: ReadonlyMap<string, string>): Search {
  const documents = new Map<string, TermCounts>();
  for (const note of snapshot.notes) documents.set(note.path, countTerms(prepareNote(contents.get(note.path) ?? '', note.basename), note.tags));
  const model = TfidfModel.build(documents);
  return (path, k, exclude) => model.similar(path, k, exclude);
}

/** Counts calls on the way to the provider. */
class CountingProvider implements EmbeddingProvider {
  calls = 0;
  constructor(private readonly inner: EmbeddingProvider) {}
  get id(): string {
    return this.inner.id;
  }
  get model(): string {
    return this.inner.model;
  }
  get capabilities() {
    return this.inner.capabilities;
  }
  embed(texts: string[]): Promise<EmbeddingResponse> {
    this.calls++;
    return this.inner.embed(texts);
  }
}

/**
 * Tier 1 search over the fixture's embedding index. Replay (the default) only reads stored vectors:
 * the HTTP port refuses every request, so evals stay offline and free. `record` embeds whatever is
 * missing with a live Ollama model and stores it.
 */
async function embeddingSearch(
  snapshot: VaultSnapshot,
  fixture: LoadedFixture,
  options: EvalOptions,
): Promise<{ search: Search | null; notice: string; calls: number; tokens: number }> {
  const preset = findPreset('ollama');
  if (!preset) throw new Error('ollama preset missing');
  const http = options.record
    ? new FetchHttp()
    : {
        request: () => Promise.reject(new ProviderError('network', 'no stored vectors')),
      };
  const provider = new CountingProvider(new OpenAICompatibleClient({ ...configFromPreset(preset, 'embeddings'), model: options.embedModel }, { http, secrets: new FakeSecrets() }));
  const index = new EmbeddingIndex(provider, new VectorStore(new NodeStorage(options.indexDir), webCryptoHasher), systemClock);
  try {
    const report = await index.update(snapshot.notes, (path) => fixture.vault.read(path));
    const set = await index.vectors();
    if (!set) throw new ProviderError('invalid-response', 'no vectors');
    const { paths, matrix } = set.toMatrix();
    const search = new DenseSearch({ paths, dims: set.dims, matrix });
    return { search: (path, k, exclude) => search.similar(path, k, exclude), notice: '', calls: provider.calls, tokens: report.tokens };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    const hint = options.record ? `embedding failed: ${error.message}` : `no stored ${options.embedModel} vectors for every note; run with --record against a local Ollama`;
    return { search: null, notice: `Tier 1 skipped for ${fixture.name}: ${hint}.`, calls: provider.calls, tokens: 0 };
  }
}

/** The top-k notes a note is not linked with yet: the link suggestion baseline (PLAN §7.5 step 1). */
function suggestLinks(snapshot: VaultSnapshot, search: Search): Map<string, string[]> {
  return new Map(
    snapshot.notes.map((note) => {
      const linked = new Set([...note.outLinks, ...note.inLinks]);
      return [note.path, search(note.path, K, linked).map((n) => n.path)];
    }),
  );
}

/** Baseline duplicate detector: a note and its nearest neighbour when they are nearly identical. */
function duplicatePairs(snapshot: VaultSnapshot, search: Search, threshold: number): [string, string][] {
  const pairs = new Map<string, [string, string]>();
  for (const note of snapshot.notes) {
    const [nearest] = search(note.path, 1, new Set());
    if (nearest && nearest.score >= threshold) pairs.set(pairKey(note.path, nearest.path), [note.path, nearest.path]);
  }
  return [...pairs.values()];
}

/**
 * Safety (PLAN §8.2): files every note where PARA says it belongs through the real apply path,
 * counts links that stopped resolving, then undoes the run and checks the vault is byte-identical.
 */
async function applyAndUndo(snapshot: VaultSnapshot, contents: ReadonlyMap<string, string>, truth: GroundTruth): Promise<SafetyMetrics> {
  const harness = applyHarness(Object.fromEntries(contents), snapshot.folders);
  const { vault, deps, storage, clock } = harness;
  const original = { contents: vault.contents(), folders: vault.folderPaths() };
  const before = await vault.graph();

  const para = presetCharter('para', truth.language);
  const folderOf = (note: NoteRecord): string | null => {
    const destination = truth.notes[note.path]?.destinations.para;
    if (!destination) return null;
    if (destination.id === DAILY) return para.system.daily?.path ?? null;
    const root = para.destinations.find((d) => d.id === destination.id)?.path;
    if (!root) return null;
    return destination.subfolder ? `${root}/${destination.subfolder}` : root;
  };
  const moves: Operation[] = [];
  const folders = new Set<string>();
  for (const note of snapshot.notes) {
    const folder = folderOf(note);
    if (folder === null || folder === parentFolder(note.path)) continue;
    for (const ancestor of [...ancestorFolders(folder), folder]) if (!snapshot.folders.includes(ancestor)) folders.add(ancestor);
    moves.push(createOperation({ kind: 'move', from: note.path, to: `${folder}/${note.path.split('/').at(-1) ?? ''}` }, { status: 'accepted', precondition: { path: note.path, contentHash: note.contentHash } }));
  }
  const operations = [...[...folders].sort().map((path) => createOperation({ kind: 'createFolder', path }, { status: 'accepted' })), ...moves];
  const plan = createPlan({ id: 'eval-safety', createdAt: new Date(clock.now()).toISOString(), operations });
  const outcome = await new ApplyRunService({ ...deps, storage, clock }).run(plan, { pluginVersion: 'eval' });
  const after = await vault.graph();
  const report = outcome.kind === 'ran' ? outcome.report : null;
  await new UndoService(deps).undoLast();
  const undoExact = JSON.stringify(vault.contents()) === JSON.stringify(original.contents) && JSON.stringify(vault.folderPaths()) === JSON.stringify(original.folders);
  return {
    operations: operations.length,
    applied: report?.applied ?? 0,
    failed: report?.failed ?? operations.length,
    brokenLinks: Math.max(0, after.unresolvedCount - before.unresolvedCount) + Math.max(0, before.edges.length - after.edges.length),
    undoExact,
  };
}
