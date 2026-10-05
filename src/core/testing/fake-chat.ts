import type { ChatProvider, ChatRequest, ChatResponse, ProviderCapabilities, ToolCall } from '../ai/types';

export type ScriptedReply = string | { text?: string; toolCalls?: ToolCall[] } | Error;

/** A chat provider that replays scripted replies in order and records every request. */
export class ScriptedChatProvider implements ChatProvider {
  readonly id = 'scripted:test';
  readonly model = 'scripted-model';
  readonly requests: ChatRequest[] = [];
  readonly capabilities: ProviderCapabilities;
  private readonly replies: ScriptedReply[];

  constructor(replies: ScriptedReply[], capabilities: Partial<ProviderCapabilities> = {}) {
    this.replies = [...replies];
    this.capabilities = { jsonSchema: true, toolCalling: true, embeddings: false, maxContext: 8192, local: true, ...capabilities };
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(structuredClone(request));
    const reply = this.replies.shift();
    if (reply === undefined) throw new Error('ScriptedChatProvider ran out of replies');
    if (reply instanceof Error) throw reply;
    const text = typeof reply === 'string' ? reply : (reply.text ?? '');
    const toolCalls = typeof reply === 'string' ? [] : (reply.toolCalls ?? []);
    return { text, toolCalls, usage: { inputTokens: 10, outputTokens: 5 }, model: this.model, finishReason: 'stop' };
  }
}
