import type { LinkIndex } from '../ports';

export interface VerificationResult {
  ok: boolean;
  /** Links that resolved before the run and no longer resolve to the same (possibly moved) file. */
  brokenLinks: Array<{ source: string; target: string }>;
  /** Unresolved links added since the baseline (0 when the count did not grow). */
  newUnresolved: number;
  message?: string;
}

const key = (source: string, target: string) => `${source}\u0000${target}`;

/**
 * Link integrity check (§5.7). Before a run it snapshots every resolved link and the number of
 * unresolved ones; after each batch every pre-existing link must still resolve to the same file
 * (at its new path if it moved), and the unresolved count must not grow. This catches the
 * "automatically update internal links" setting being off, sync tools racing with moves, and moves
 * that silently redirect an existing link to a different note.
 */
export class LinkVerifier {
  private baselineEdges: Array<[string, string]> | null = null;
  private baselineUnresolved = 0;

  constructor(private readonly links: LinkIndex) {}

  async captureBaseline(): Promise<void> {
    const graph = await this.links.graph();
    this.baselineEdges = graph.edges;
    this.baselineUnresolved = graph.unresolvedCount;
  }

  async check(moves: ReadonlyMap<string, string>): Promise<VerificationResult> {
    if (!this.baselineEdges) throw new Error('captureBaseline() must run before check()');
    const graph = await this.links.graph();
    const current = new Set(graph.edges.map(([source, target]) => key(source, target)));
    const moved = (path: string) => moves.get(path) ?? path;

    const brokenLinks = this.baselineEdges
      .filter(([source, target]) => !current.has(key(moved(source), moved(target))))
      .map(([source, target]) => ({ source: moved(source), target: moved(target) }));
    const newUnresolved = Math.max(0, graph.unresolvedCount - this.baselineUnresolved);
    const ok = brokenLinks.length === 0 && newUnresolved === 0;
    return { ok, brokenLinks, newUnresolved, message: ok ? undefined : describe(brokenLinks, newUnresolved) };
  }
}

function describe(broken: Array<{ source: string; target: string }>, newUnresolved: number): string {
  const parts: string[] = [];
  if (broken.length > 0) {
    const first = broken[0];
    const example = first ? ` (e.g. "${first.source}" → "${first.target}")` : '';
    parts.push(`${broken.length} existing ${broken.length === 1 ? 'link no longer resolves' : 'links no longer resolve'}${example}`);
  }
  if (newUnresolved > 0) parts.push(`${newUnresolved} new unresolved ${newUnresolved === 1 ? 'link' : 'links'}`);
  return `Link verification failed: ${parts.join('; ')}.`;
}
