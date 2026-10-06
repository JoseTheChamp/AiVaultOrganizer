import * as z from 'zod';
import type { ChatMessage, ToolDefinition } from '../types';
import { languageName } from './types';

export interface CharterAgentInput {
  language: 'en' | 'cs';
  /** What the user asked for, if anything ("keep my folders", "use PARA"). */
  wish: string;
}

/** Arguments of each tool, validated before the tool runs (invariant 3). */
export const toolArguments = {
  get_vault_overview: z.object({}).loose(),
  get_method_scores: z.object({}).loose(),
  list_clusters: z.object({}).loose(),
  get_cluster_samples: z.object({ clusterId: z.number().int().nonnegative(), n: z.number().int().min(1).max(8).default(4) }),
  list_presets: z.object({}).loose(),
  get_preset: z.object({ id: z.string().min(1) }),
  propose_charter: z.object({ yaml: z.string().min(1) }),
} as const;

export type ToolName = keyof typeof toolArguments;

const noArguments = { type: 'object', properties: {}, additionalProperties: false };

export const CHARTER_AGENT_TOOLS: ToolDefinition[] = [
  { name: 'get_vault_overview', description: 'Counts, top-level folders with note counts, language, common tags and properties.', parameters: noArguments },
  { name: 'get_method_scores', description: 'How well the vault already matches each organization method, with evidence.', parameters: noArguments },
  { name: 'list_clusters', description: 'Groups of notes about the same subject: id, label, size and keywords.', parameters: noArguments },
  {
    name: 'get_cluster_samples',
    description: 'Titles and short excerpts of a few notes from one cluster.',
    parameters: { type: 'object', properties: { clusterId: { type: 'integer' }, n: { type: 'integer', minimum: 1, maximum: 8 } }, required: ['clusterId'], additionalProperties: false },
  },
  { name: 'list_presets', description: 'The organization methods the plugin knows, with a summary of each.', parameters: noArguments },
  {
    name: 'get_preset',
    description: "A method's default charter in the vault's language, as YAML to adapt.",
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'propose_charter',
    description: 'Submit the charter as YAML. Returns problems to fix, or confirms the draft.',
    parameters: { type: 'object', properties: { yaml: { type: 'string' } }, required: ['yaml'], additionalProperties: false },
  },
];

/**
 * `charter-agent` v1 (PLAN §7.7, §7.8): drafts a charter by exploring the vault through read-only
 * tools and adapting a preset. The draft is only ever shown to the user in the wizard; the agent
 * cannot write anything, and its only way to finish is a draft that passes validation.
 */
export const charterAgentV1 = {
  id: 'charter-agent',
  version: 1,
  tools: CHARTER_AGENT_TOOLS,

  build(input: CharterAgentInput): ChatMessage[] {
    const language = languageName(input.language);
    return [
      {
        role: 'system',
        content: [
          "You help someone organize their Obsidian vault by drafting its charter: the destinations notes go to, as YAML in the plugin's charter format.",
          'Work in a few steps: look at the overview, the method scores and the clusters; pick the method that fits the vault and the person; get that preset; adapt it.',
          'Adapt rather than invent: keep folders that already work, name destinations in the language of the notes, and describe each destination in one sentence a person can follow.',
          `Write folder names and descriptions in ${language}.`,
          'Finish by calling propose_charter with the full YAML. If it reports problems, fix them and call it again.',
        ].join(' '),
      },
      { role: 'user', content: input.wish.trim() || 'Draft a charter for my vault.' },
    ];
  },
};
