import * as z from 'zod';
import type { Result } from '../../model/result';
import { estimateRequest, type TokenEstimate } from '../budget';
import { generateStructured, type StructuredError, type StructuredSuccess } from '../structured';
import type { ChatMessage, ChatProvider } from '../types';

/**
 * A versioned prompt (CLAUDE.md, PLAN §7.8): how to ask, and what shape the answer must have. The
 * schema may depend on the input (for example an enum of the ids the model may answer with), so a
 * model can never refer to something it was not shown. Changing a prompt means a new version file,
 * an eval run and a note in the commit.
 */
export interface Prompt<Input, Output> {
  id: string;
  version: number;
  build(input: Input): ChatMessage[];
  schema(input: Input): z.ZodType<Output>;
  /** Output budget for this input. */
  maxTokens(input: Input): number;
}

/** Runs a prompt deterministically (temperature 0) with validation and one repair round. */
export function runPrompt<Input, Output>(
  provider: ChatProvider,
  prompt: Prompt<Input, Output>,
  input: Input,
): Promise<Result<StructuredSuccess<Output>, StructuredError>> {
  return generateStructured(provider, {
    messages: prompt.build(input),
    schema: prompt.schema(input),
    schemaName: prompt.id.replace(/-/g, '_'),
    maxTokens: prompt.maxTokens(input),
    temperature: 0,
    prompt: { id: prompt.id, version: prompt.version },
  });
}

/**
 * Tokens one `runPrompt` call would use, schema included (it is sent with the request or written
 * into it): the basis of every estimate shown before a run. A repair round is not counted.
 */
export function estimatePrompt<Input, Output>(prompt: Prompt<Input, Output>, input: Input): TokenEstimate {
  const schema = z.toJSONSchema(prompt.schema(input)) as Record<string, unknown>;
  return estimateRequest({ messages: prompt.build(input), schema: { name: prompt.id, schema }, maxTokens: prompt.maxTokens(input) });
}

/** "English" or "Czech": the language the model should answer in. */
export function languageName(language: 'en' | 'cs'): string {
  return language === 'cs' ? 'Czech' : 'English';
}
