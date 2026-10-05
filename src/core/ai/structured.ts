import * as z from 'zod';
import { err, ok, type Result } from '../model/result';
import { type ChatMessage, type ChatProvider, type ChatResponse, ProviderError } from './types';

export interface StructuredRequest<T> {
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  /** Short identifier of the output, e.g. `classification`. */
  schemaName: string;
  maxTokens?: number;
  temperature?: number;
  prompt?: { id: string; version: number };
}

export interface StructuredSuccess<T> {
  value: T;
  /** The response that produced `value`. */
  response: ChatResponse;
  /** Model calls made, including repairs. */
  attempts: number;
  repaired: boolean;
}

export type StructuredError =
  | { kind: 'invalid-output'; issues: string[]; raw: string; attempts: number }
  | { kind: 'provider'; error: ProviderError; attempts: number };

/**
 * Asks a model for output matching a zod schema (PLAN §7.9): native schema enforcement where the
 * provider supports it, otherwise JSON mode with the schema in the prompt. The answer is always
 * validated with zod (invariant 3); on failure the validation errors are sent back for a repair
 * round. Expected failures come back as a Result; anything else is a bug and throws.
 */
export async function generateStructured<T>(
  provider: ChatProvider,
  request: StructuredRequest<T>,
  options: { repairRounds?: number } = {},
): Promise<Result<StructuredSuccess<T>, StructuredError>> {
  const jsonSchema = z.toJSONSchema(request.schema) as Record<string, unknown>;
  const native = provider.capabilities.jsonSchema;
  const messages = native ? [...request.messages] : withSchemaInstructions(request.messages, jsonSchema);
  const maxAttempts = 1 + Math.max(0, options.repairRounds ?? 1);

  let lastIssues: string[] = [];
  let lastRaw = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: ChatResponse;
    try {
      response = await provider.chat({
        messages,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        prompt: request.prompt,
        ...(native ? { schema: { name: request.schemaName, schema: jsonSchema } } : { jsonMode: true }),
      });
    } catch (error) {
      if (error instanceof ProviderError) return err({ kind: 'provider', error, attempts: attempt });
      throw error;
    }

    lastRaw = response.text;
    const json = extractJson(response.text);
    if (json.ok) {
      const parsed = request.schema.safeParse(json.value);
      if (parsed.success) return ok({ value: parsed.data, response, attempts: attempt, repaired: attempt > 1 });
      lastIssues = formatIssues(parsed.error);
    } else {
      lastIssues = [json.error];
    }
    messages.push(
      { role: 'assistant', content: response.text },
      {
        role: 'user',
        content: `Your reply could not be used:\n${lastIssues.map((issue) => `- ${issue}`).join('\n')}\nReply again with only the corrected JSON.`,
      },
    );
  }
  return err({ kind: 'invalid-output', issues: lastIssues, raw: lastRaw, attempts: maxAttempts });
}

function withSchemaInstructions(messages: ChatMessage[], schema: Record<string, unknown>): ChatMessage[] {
  const instruction = `Respond with a single JSON value that matches this JSON schema. Output only the JSON: no prose, no code fences.\n${JSON.stringify(schema)}`;
  const [first, ...rest] = messages;
  if (first?.role === 'system') return [{ role: 'system', content: `${first.content}\n\n${instruction}` }, ...rest];
  return [{ role: 'system', content: instruction }, ...messages];
}

/** Parses JSON from model text, tolerating code fences and prose around one JSON value. */
export function extractJson(text: string): Result<unknown, string> {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return ok(JSON.parse(trimmed) as unknown);
  } catch {
    // Fall through to locating the outermost object or array.
  }
  const starts = [trimmed.indexOf('{'), trimmed.indexOf('[')].filter((index) => index !== -1);
  if (starts.length === 0) return err('The reply contained no JSON.');
  const start = Math.min(...starts);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (end <= start) return err('The reply contained incomplete JSON.');
  try {
    return ok(JSON.parse(trimmed.slice(start, end + 1)) as unknown);
  } catch {
    return err('The reply was not valid JSON.');
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 10).map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`);
}
