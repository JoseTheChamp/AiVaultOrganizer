# 0004. Bring-your-own-model provider layer

- Status: Accepted
- Date: 2026-10-05

## Context

The plugin's AI features (classification, link suggestions, charter drafting) need a language model and
an embedding model, but the product promises no servers, no telemetry and no accounts (invariant 5).
Users must be able to run fully locally (Ollama, LM Studio) or bring their own key for a cloud provider.
Their notes are private, so nothing may leave the computer by accident.

The provider layer also has to work in two runtimes. Inside Obsidian, HTTP must go through `requestUrl`;
`fetch` is not allowed in plugin code. In Node, the eval CLI and tests must run the same code offline and
reproducibly. Model output is untrusted input (invariant 3), and small local models often return invalid
JSON. Cloud calls cost money, and both cloud and local servers have rate limits.

## Decision

**Two clients behind one interface.** `ChatProvider` and `EmbeddingProvider` (`src/core/ai/types.ts`) expose
`chat`, `embed`, `listModels` and declared capabilities (`jsonSchema`, `toolCalling`, `embeddings`,
`maxContext`, `local`). The implementations are:

- `OpenAICompatibleClient`: `/chat/completions`, `/embeddings` and `/models`. It covers Ollama, LM Studio,
  OpenAI, OpenRouter, Gemini, Mistral, Groq and any custom endpoint.
- `AnthropicClient`: the native Messages API.

Both talk raw HTTP through `HttpPort`. Inside Obsidian that is `requestUrl`; in Node it is `fetch` (eval
only). No vendor SDK is bundled.

**Structured output.** The order of preference is:

1. Native schema enforcement: `response_format: json_schema` for OpenAI-compatible servers, and
   `output_config.format` for Anthropic.
2. JSON mode with the schema in the prompt.
3. In every case, `generateStructured` validates with zod and allows one repair round, which sends the
   validation issues back to the model. After that it returns a typed `invalid-output` error, never a
   partially trusted value.

For Anthropic the schema is converted (`toAnthropicSchema`): closed objects, and none of the keywords the
API rejects. zod still enforces the full schema afterwards.

**Composition.** `createChatProvider` builds a stack. From outermost to innermost:

- **Cache:** content-addressed by provider, model, prompt id and version, messages, schema and tools.
  Stored in `.ai-vault-organizer/cache/llm/`. A hit costs nothing.
- **Budget:** a hard token and call ceiling per run, checked against an estimate before each call and
  recorded from reported usage after it.
- **Resilience:** a concurrency pool (default 2 for local, 4 for cloud), a token-bucket rate limiter, and
  retries with exponential backoff and jitter on network errors, timeouts, 429 and 5xx. Retries honour
  `Retry-After`.
- **Client.**
- **Local-only HTTP guard.**

The connection test bypasses the cache, the budget and retries, but not the local-only guard.

**Privacy defaults.**

- **AI starts off.** Every feature works without it.
- **Local-only mode starts on.** It is enforced at the HTTP layer, so it covers every client and anything
  added later: any non-loopback URL is refused before a request is made. Using a cloud provider is
  therefore two deliberate steps (pick the provider, turn local-only off).
- **Keys stay in the keychain.** API keys live only in Obsidian's SecretStorage. `data.json` stores the
  secret's name, and a test guards this.

**Reproducibility.** The HTTP layer can record to and replay from cassettes (`CassetteHttp`). Tests replay
committed cassettes and never touch the network. Recording scrubs authorization headers and key-like
query parameters, and a test scans every cassette for secret patterns.

### Deviations from PLAN §7

- **Anthropic structured output.** The plan said forced tool use. Current Claude models (Opus 5.5,
  Sonnet 5.5, Fable 5.1) reject a forced `tool_choice` with a 400. Native structured output is
  enforced server-side and needs no tool round trip. Tools stay available with `tool_choice: auto`, and
  the system prompt names the expected tool.
- **No temperature.** Sampling parameters are not sent to Anthropic, because current models reject them.
- **Refusal fallback.** Models that support it get `fallbacks: "default"`: if a safety classifier
  declines, the API retries on a fallback model server-side. A final `stop_reason: refusal` becomes a
  typed, non-retryable `refusal` error.
- **Commits.** Two commits were added to the planned list: one wires the stack from settings, and one
  records the first real Ollama cassette.

## Consequences

- Any OpenAI-compatible server works without new code. A new native API means a new client behind the
  same interface.
- Owning the HTTP layer means owning the protocol details: error mapping, `Retry-After`, refusals and
  schema dialects. Provider changes must be tracked by hand. The cassettes and the Ollama smoke test catch
  drift on re-record.
- Repeated runs are free and deterministic thanks to the cache, which is also why evals can replay. The
  cache holds model responses, which may quote note content. It lives inside the vault's plugin folder
  and can be cleared from settings.
- A refusal or invalid output is an expected `Result`, not an exception. Callers must mark the affected
  items as ambiguous rather than guess.
- Prompt-level privacy controls are not part of this layer. Those are the consent step, ignore globs and
  the per-note private property. The planner adds them when it starts sending note content.

## Alternatives considered

- **Vendor SDKs** (`openai`, `@anthropic-ai/sdk`). They are built on `fetch`, so they would need a
  `requestUrl` shim for every request, including streaming. They add bundle weight per vendor and would
  still leave the local servers to a separate client. The surface we use is small: one request type per
  API.
- **Multi-provider frameworks** (LangChain, Vercel AI SDK). These are heavy, have broad transitive
  dependencies, and are built for agents and streaming UIs the plugin doesn't need. They would also
  make the single-write-path and local-only guarantees harder to audit.
- **Anthropic through its OpenAI-compatible endpoint.** That would mean one client for everything. But
  that endpoint is documented for testing and comparison rather than production, and it does not
  expose native structured output or refusal handling.
- **Local-only as a per-provider flag.** Rejected. A guard at the HTTP port cannot be bypassed by a
  forgotten flag in a new client.
