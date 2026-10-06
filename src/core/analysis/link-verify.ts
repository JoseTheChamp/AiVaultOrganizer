import { runPrompt } from '../ai/prompts/types';
import { verifyLinksV1 } from '../ai/prompts/verify-links.v1';
import type { ChatProvider } from '../ai/types';
import type { NoteCard } from '../planner/cards';
import type { LinkCandidate } from './link-candidates';

export interface Verdict {
  relevant: boolean;
  /** 1 loosely, 2 related, 3 closely related. */
  strength: number;
  reason: string;
}

export interface VerifiedCandidate extends LinkCandidate {
  /** The model's verdict, or null when the pair could not be verified. */
  verdict: Verdict | null;
}

export interface VerifyReport {
  /** Candidates the model judged relevant, plus those it could not judge (verdict null). */
  kept: VerifiedCandidate[];
  /** Candidates the model judged not relevant. */
  rejected: VerifiedCandidate[];
  /** Pairs sent to the model. */
  pairs: number;
  calls: number;
  failures: number;
  repaired: number;
  inputTokens: number;
  outputTokens: number;
}

export interface VerifyOptions {
  /** Only each note's top candidates are verified; the rest are dropped. */
  perNote: number;
  batchSize: number;
}

export const DEFAULT_VERIFY: VerifyOptions = { perNote: 3, batchSize: 8 };

/**
 * Tier 2 link verification (PLAN §7.5 step 3): each note's top candidates go to the model as pairs
 * of note cards, a batch at a time; only pairs it marks relevant survive, with its reason for the
 * review. Each unordered pair is asked once. Pairs involving a note without a card (a private note)
 * are never sent. When a batch fails, its candidates are kept unverified rather than lost.
 */
export async function verifyLinks(
  provider: ChatProvider,
  language: 'en' | 'cs',
  candidates: ReadonlyMap<string, readonly LinkCandidate[]>,
  cards: ReadonlyMap<string, NoteCard>,
  options: VerifyOptions = DEFAULT_VERIFY,
): Promise<VerifyReport> {
  const report: VerifyReport = { kept: [], rejected: [], pairs: 0, calls: 0, failures: 0, repaired: 0, inputTokens: 0, outputTokens: 0 };
  const key = (a: string, b: string): string => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  const selected = [...candidates.values()].flatMap((list) => list.slice(0, options.perNote)).filter((c) => cards.has(c.source) && cards.has(c.target));
  const unique = new Map<string, LinkCandidate>();
  for (const candidate of selected) if (!unique.has(key(candidate.source, candidate.target))) unique.set(key(candidate.source, candidate.target), candidate);

  const verdicts = new Map<string, Verdict | null>();
  const pairs = [...unique.entries()];
  report.pairs = pairs.length;
  for (let start = 0; start < pairs.length; start += options.batchSize) {
    const batch = pairs.slice(start, start + options.batchSize);
    const input = {
      language,
      pairs: batch.map(([, candidate], i) => ({ id: `p${i + 1}`, a: cards.get(candidate.source) as NoteCard, b: cards.get(candidate.target) as NoteCard })),
    };
    const result = await runPrompt(provider, verifyLinksV1, input);
    report.calls += result.ok ? result.value.attempts : result.error.attempts;
    if (!result.ok) {
      report.failures++;
      for (const [pairKey] of batch) verdicts.set(pairKey, null);
      continue;
    }
    if (result.value.repaired) report.repaired++;
    report.inputTokens += result.value.response.usage.inputTokens;
    report.outputTokens += result.value.response.usage.outputTokens;
    const byId = new Map(result.value.value.pairs.map((pair) => [pair.pairId, pair]));
    batch.forEach(([pairKey], i) => {
      const answer = byId.get(`p${i + 1}`);
      verdicts.set(pairKey, answer ? { relevant: answer.relevant, strength: answer.strength, reason: answer.reason } : null);
    });
  }

  for (const candidate of selected) {
    const verdict = verdicts.get(key(candidate.source, candidate.target)) ?? null;
    const verified = { ...candidate, verdict };
    if (verdict && !verdict.relevant) report.rejected.push(verified);
    else report.kept.push(verified);
  }
  return report;
}
