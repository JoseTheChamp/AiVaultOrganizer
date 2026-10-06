import { describe, expect, it } from 'vitest';
import { analyzeVault } from '../../analysis/analyze';
import { presetCharter } from '../../charter/presets';
import { stringifyCharter } from '../../charter/yaml';
import { testCard } from '../../testing/cards';
import { ScriptedChatProvider } from '../../testing/fake-chat';
import { tinyParaVault } from '../../testing/fixtures';
import { InMemoryVault } from '../../testing/in-memory-vault';
import { charterAgentV1 } from '../prompts/charter-agent.v1';
import type { ToolCall } from '../types';
import { type AgentContext, draftCharter } from './charter-agent';

let ids = 0;
const call = (name: string, args: unknown = {}): ToolCall => ({ id: `c${++ids}`, name, arguments: args, rawArguments: JSON.stringify(args) });

async function context(): Promise<AgentContext> {
  const { files, folders } = tinyParaVault();
  const snapshot = await InMemoryVault.from(files, { folders }).snapshot();
  return {
    analysis: analyzeVault(snapshot, { now: Date.UTC(2026, 9, 7) }),
    language: 'en',
    clusters: [{ id: 0, label: 'Website work', keywords: ['website', 'launch'], size: 4, samples: [testCard('Website relaunch.md', 'Ship the new site.')] }],
  };
}

const goodYaml = stringifyCharter(presetCharter('para', 'en'));

describe('draftCharter', () => {
  it('explores with tools, fixes what propose_charter reports, and returns the valid draft', async () => {
    const provider = new ScriptedChatProvider([
      { toolCalls: [call('get_vault_overview'), call('get_method_scores'), call('list_clusters')] },
      { toolCalls: [call('get_cluster_samples', { clusterId: 0 }), call('get_preset', { id: 'para' })] },
      { toolCalls: [call('propose_charter', { yaml: goodYaml.replace('language: en', 'language: cs') })] },
      { toolCalls: [call('propose_charter', { yaml: goodYaml })] },
    ]);
    const result = await draftCharter(provider, await context(), 'Use PARA.');
    expect(result).toMatchObject({ ok: true, steps: 4, toolCalls: 7 });
    expect(result.ok && result.charter.preset).toBe('para');

    const tools = provider.requests[1]?.messages.filter((m) => m.role === 'tool') ?? [];
    expect(tools.map((m) => m.content.split('\n')[0])).toEqual([
      expect.stringMatching(/^Notes: \d+; folders: \d+/),
      expect.stringMatching(/^para: \d+ %/),
      'Website work (4 notes) — website, launch'.replace(/^/, '0: '),
    ]);
    const fix = provider.requests[3]?.messages.at(-1);
    expect(fix?.content).toContain('The vault is written in "en", but the charter says "cs".');
    expect(provider.requests[0]?.tools?.map((t) => t.name)).toEqual(charterAgentV1.tools.map((t) => t.name));
    expect(provider.requests[0]?.prompt).toEqual({ id: 'charter-agent', version: 1 });
  });

  it('reports invalid YAML with lines, unknown tools and bad arguments back to the model', async () => {
    const provider = new ScriptedChatProvider([
      { toolCalls: [call('delete_everything'), call('get_cluster_samples', { clusterId: 'x' }), call('propose_charter', { yaml: 'version: 1\ndestinations: nope' })] },
      { toolCalls: [call('propose_charter', { yaml: goodYaml })] },
    ]);
    const result = await draftCharter(provider, await context());
    expect(result.ok).toBe(true);
    const replies = provider.requests[1]?.messages.filter((m) => m.role === 'tool').map((m) => m.content) ?? [];
    expect(replies[0]).toMatch(/^Unknown tool "delete_everything"/);
    expect(replies[1]).toMatch(/^Invalid arguments for get_cluster_samples: clusterId/);
    expect(replies[2]).toMatch(/^The draft has problems/);
  });

  it('nudges a model that answers without tools', async () => {
    const provider = new ScriptedChatProvider(['Here is my plan…', { toolCalls: [call('propose_charter', { yaml: goodYaml })] }]);
    expect((await draftCharter(provider, await context())).ok).toBe(true);
    expect(provider.requests[1]?.messages.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('propose_charter') as string });
  });

  it('stops after its step budget and its token budget, with the last problems', async () => {
    const bad = { toolCalls: [call('propose_charter', { yaml: goodYaml.replace('language: en', 'language: cs') })] };
    const steps = await draftCharter(new ScriptedChatProvider([bad, bad, bad]), await context(), '', { maxSteps: 3, maxTokens: 1_000_000 });
    expect(steps).toMatchObject({ ok: false, steps: 3, reason: 'No valid draft within 3 steps.', lastProblems: [expect.stringContaining('"cs"')] });
    const tokens = await draftCharter(new ScriptedChatProvider([bad]), await context(), '', { maxSteps: 8, maxTokens: 100 });
    expect(tokens).toMatchObject({ ok: false, steps: 0, reason: 'The token budget ran out before a valid draft.' });
  });
});
