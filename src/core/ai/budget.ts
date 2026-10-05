import { type ChatProvider, type ChatRequest, type ChatResponse, ProviderError, type Usage } from './types';

/**
 * Rough token count for budgeting and the consent screen (PLAN §7.10): about four characters per
 * token for ASCII text; other scripts and diacritics (Czech) split into more tokens, so non-ASCII
 * characters count double. Deliberately pessimistic: estimates should not under-promise cost.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil((ascii + other * 2) / 4);
}

/** Tokens per message for role markers and separators. */
const MESSAGE_OVERHEAD = 4;
/** Output assumed when a request sets no limit; real outputs for our prompts are far shorter. */
const DEFAULT_OUTPUT_ESTIMATE = 1024;

export interface TokenEstimate {
  input: number;
  /** Upper bound: the request's max output, or a default. */
  output: number;
}

export function estimateRequest(request: ChatRequest): TokenEstimate {
  let input = 0;
  for (const message of request.messages) {
    input += MESSAGE_OVERHEAD + estimateTokens(message.content);
    if (message.role === 'assistant') for (const call of message.toolCalls ?? []) input += estimateTokens(call.rawArguments);
  }
  if (request.schema) input += estimateTokens(JSON.stringify(request.schema.schema));
  if (request.tools) input += estimateTokens(JSON.stringify(request.tools));
  return { input, output: request.maxTokens ?? DEFAULT_OUTPUT_ESTIMATE };
}

/** Per-million-token prices the user entered in settings; nothing is hard-coded. */
export interface Prices {
  inputPerMillion?: number;
  outputPerMillion?: number;
}

/** Cost in the user's currency, or null when no prices are configured. */
export function estimateCost(tokens: { input: number; output: number }, prices: Prices): number | null {
  if (prices.inputPerMillion === undefined && prices.outputPerMillion === undefined) return null;
  return (tokens.input * (prices.inputPerMillion ?? 0) + tokens.output * (prices.outputPerMillion ?? 0)) / 1_000_000;
}

export interface BudgetLimits {
  /** Input plus output tokens for the whole run. */
  maxTokens: number;
  maxCalls?: number;
}

/** Hard ceiling for one run (one plan, one eval): calls that would exceed it are refused up front. */
export class RunBudget {
  private calls = 0;
  private input = 0;
  private output = 0;

  constructor(readonly limits: BudgetLimits) {}

  get used(): { calls: number; inputTokens: number; outputTokens: number; totalTokens: number } {
    return { calls: this.calls, inputTokens: this.input, outputTokens: this.output, totalTokens: this.input + this.output };
  }

  /** Why a call with this estimate would break the budget, or null when it fits. */
  refusal(estimate: TokenEstimate): string | null {
    if (this.limits.maxCalls !== undefined && this.calls + 1 > this.limits.maxCalls) {
      return `The run's limit of ${this.limits.maxCalls} model calls is reached.`;
    }
    const projected = this.input + this.output + estimate.input + estimate.output;
    if (projected > this.limits.maxTokens) {
      return `The next call would bring the run to about ${projected.toLocaleString('en-US')} tokens, over its budget of ${this.limits.maxTokens.toLocaleString('en-US')}.`;
    }
    return null;
  }

  record(usage: Usage): void {
    this.calls++;
    this.input += usage.inputTokens;
    this.output += usage.outputTokens;
  }
}

/** Enforces a RunBudget around a provider and records what each call actually used. */
export class BudgetedChatProvider implements ChatProvider {
  constructor(
    private readonly inner: ChatProvider,
    readonly budget: RunBudget,
  ) {}

  get id(): string {
    return this.inner.id;
  }

  get model(): string {
    return this.inner.model;
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const estimate = estimateRequest(request);
    const refusal = this.budget.refusal(estimate);
    if (refusal) throw new ProviderError('budget', refusal);
    const response = await this.inner.chat(request);
    // Some local servers report no usage; fall back to the estimate so the budget still bites.
    const reported = response.usage.inputTokens + response.usage.outputTokens > 0;
    this.budget.record(reported ? response.usage : { inputTokens: estimate.input, outputTokens: estimateTokens(response.text) });
    return response;
  }
}
