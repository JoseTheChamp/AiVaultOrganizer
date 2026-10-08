import type { VaultAnalysis } from '../../analysis/analyze';
import { PRESET_ORDER, PRESETS, presetCharter } from '../../charter/presets';
import type { Charter } from '../../charter/schema';
import { parseCharterYaml, stringifyCharter } from '../../charter/yaml';
import { METHOD_LABELS, type MethodId } from '../../model/methods';
import { type NoteCard, renderCard } from '../../planner/cards';
import { estimateRequest } from '../budget';
import { charterAgentV1, type ToolName, toolArguments } from '../prompts/charter-agent.v1';
import { type ChatMessage, type ChatProvider, ProviderError, type ToolCall } from '../types';

export interface AgentCluster {
  id: number;
  label: string;
  keywords: string[];
  /** Representative notes (cards only exist for notes that may go to a model). */
  samples: NoteCard[];
  size: number;
}

export interface AgentContext {
  analysis: VaultAnalysis;
  language: 'en' | 'cs';
  clusters: AgentCluster[];
}

export interface AgentOptions {
  /** Model calls before the agent gives up (PLAN §7.7: 8). */
  maxSteps: number;
  /** Token budget for the whole run (input and output, estimated). */
  maxTokens: number;
  /** Checked before every step: a stopped agent returns without a draft. */
  signal?: { readonly aborted: boolean };
}

export const DEFAULT_AGENT: AgentOptions = { maxSteps: 8, maxTokens: 40_000 };

export type AgentResult =
  | { ok: true; charter: Charter; steps: number; toolCalls: number }
  | { ok: false; reason: string; steps: number; toolCalls: number; lastProblems: string[] };

/**
 * The charter drafting agent (PLAN §7.7): a bounded tool-calling loop. The model can only read the
 * analysis through the tools and submit drafts; every argument is validated, every draft is
 * checked against the charter schema and the vault, and the run ends on the first valid draft or
 * when its step or token budget runs out. The result is a draft for the user to review in the
 * wizard, never something written to the vault.
 */
export async function draftCharter(provider: ChatProvider, context: AgentContext, wish = '', options: AgentOptions = DEFAULT_AGENT): Promise<AgentResult> {
  const messages: ChatMessage[] = charterAgentV1.build({ language: context.language, wish });
  let toolCalls = 0;
  let spent = 0;
  let lastProblems: string[] = [];
  for (let step = 1; step <= options.maxSteps; step++) {
    if (options.signal?.aborted) return { ok: false, reason: 'Stopped.', steps: step - 1, toolCalls, lastProblems };
    const request = { messages, tools: charterAgentV1.tools, toolChoice: 'auto' as const, temperature: 0, maxTokens: 2000, prompt: { id: charterAgentV1.id, version: charterAgentV1.version } };
    const estimate = estimateRequest(request);
    if (spent + estimate.input + estimate.output > options.maxTokens) return { ok: false, reason: 'The token budget ran out before a valid draft.', steps: step - 1, toolCalls, lastProblems };
    let response;
    try {
      response = await provider.chat(request);
    } catch (error) {
      if (error instanceof ProviderError) return { ok: false, reason: error.message, steps: step, toolCalls, lastProblems };
      throw error;
    }
    spent += response.usage.inputTokens + response.usage.outputTokens;
    messages.push({ role: 'assistant', content: response.text, toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) {
      messages.push({ role: 'user', content: 'Use the tools, and finish by calling propose_charter with the full YAML.' });
      continue;
    }
    for (const call of response.toolCalls) {
      toolCalls++;
      const outcome = runTool(call, context);
      if (outcome.charter) return { ok: true, charter: outcome.charter, steps: step, toolCalls };
      if (outcome.problems) lastProblems = outcome.problems;
      messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: outcome.content });
    }
  }
  return { ok: false, reason: `No valid draft within ${options.maxSteps} steps.`, steps: options.maxSteps, toolCalls, lastProblems };
}

interface ToolOutcome {
  content: string;
  charter?: Charter;
  problems?: string[];
}

function runTool(call: ToolCall, context: AgentContext): ToolOutcome {
  if (!(call.name in toolArguments)) return { content: `Unknown tool "${call.name}". Available: ${Object.keys(toolArguments).join(', ')}.` };
  const name = call.name as ToolName;
  const parsed = toolArguments[name].safeParse(call.arguments ?? {});
  if (!parsed.success) return { content: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ')}` };
  const args = parsed.data as Record<string, unknown>;
  const { analysis } = context;
  switch (name) {
    case 'get_vault_overview': {
      const { stats } = analysis;
      return {
        content: [
          `Notes: ${stats.noteCount}; folders: ${stats.folderCount}; notes in the root: ${Math.round(stats.rootShare * 100)} %.`,
          `Language: ${stats.language.language}.`,
          `Top-level folders: ${stats.topLevelFolders.slice(0, 15).map((f) => `${f.path} (${f.noteCount})`).join(', ') || 'none'}.`,
          `Common tags: ${stats.tags.usage.slice(0, 10).map((t) => `#${t.tag} (${t.count})`).join(', ') || 'none'}.`,
          `Common properties: ${stats.properties.slice(0, 10).map((p) => `${p.key} (${Math.round(p.share * 100)} %)`).join(', ') || 'none'}.`,
        ].join('\n'),
      };
    }
    case 'get_method_scores':
      return { content: analysis.methods.scores.map((s) => `${s.method}: ${Math.round(s.score * 100)} % (${s.reasons.join(' ') || 'no evidence'})`).join('\n') };
    case 'list_clusters':
      return { content: context.clusters.map((c) => `${c.id}: ${c.label} (${c.size} notes) — ${c.keywords.slice(0, 6).join(', ')}`).join('\n') || 'No clusters.' };
    case 'get_cluster_samples': {
      const cluster = context.clusters.find((c) => c.id === args.clusterId);
      if (!cluster) return { content: `No cluster ${String(args.clusterId)}.` };
      return { content: cluster.samples.slice(0, Number(args.n ?? 4)).map((card) => renderCard(card, 160)).join('\n---\n') || 'No notes to show.' };
    }
    case 'list_presets':
      return { content: PRESET_ORDER.map((id) => `${id}: ${METHOD_LABELS[id]}. ${PRESETS[id].summary.en.replace(/\*\*/g, '')}`).join('\n') };
    case 'get_preset': {
      const id = String(args.id) as MethodId;
      if (!PRESET_ORDER.includes(id)) return { content: `Unknown preset "${String(args.id)}". Use one of: ${PRESET_ORDER.join(', ')}.` };
      return { content: stringifyCharter(presetCharter(id, context.language)) };
    }
    case 'propose_charter': {
      const result = parseCharterYaml(String(args.yaml));
      if (!result.ok) {
        const problems = result.error.map((issue) => `${issue.line ? `line ${issue.line}: ` : ''}${issue.message}`);
        return { content: `The draft has problems; fix them and call propose_charter again:\n${problems.join('\n')}`, problems };
      }
      const problems = vaultProblems(result.value, context);
      if (problems.length > 0) return { content: `The draft is valid YAML but does not fit the vault yet:\n${problems.join('\n')}`, problems };
      return { content: 'Accepted.', charter: result.value };
    }
  }
}

/** Checks a schema-valid draft against the vault (PLAN §7.7). */
function vaultProblems(charter: Charter, context: AgentContext): string[] {
  const problems: string[] = [];
  if (charter.language.slice(0, 2).toLowerCase() !== context.language) problems.push(`The vault is written in "${context.language}", but the charter says "${charter.language}".`);
  if (charter.destinations.length < 2) problems.push('A charter needs at least two destinations.');
  const ids = charter.destinations.map((d) => d.id);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) problems.push(`Destination id "${id}" is used twice.`);
  const paths = charter.destinations.map((d) => d.path?.toLowerCase()).filter((p): p is string => p !== undefined);
  for (const path of new Set(paths.filter((p, i) => paths.indexOf(p) !== i))) problems.push(`Two destinations share the folder "${path}".`);
  for (const destination of charter.destinations) if (destination.description.trim().length < 10) problems.push(`Destination "${destination.id}" needs a description a person can follow.`);
  return problems;
}
