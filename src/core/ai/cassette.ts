import * as z from 'zod';
import { stableStringify } from '../model/stable-hash';
import type { Hasher, HttpPort, HttpRequest, HttpResponse } from '../ports';

/**
 * Record/replay of HTTP traffic for tests and evals (PLAN §8.3). In replay mode no network is
 * touched: responses come from a cassette keyed by method, URL and body. Cassettes never store
 * request headers (that is where API keys live), keep only harmless response headers, and strip
 * key-like URL parameters (invariant 6).
 */

const interactionSchema = z.object({
  key: z.string(),
  request: z.object({ method: z.string(), url: z.string(), body: z.unknown() }),
  response: z.object({ status: z.number(), headers: z.record(z.string(), z.string()), text: z.string() }),
});

export const cassetteSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  recordedAt: z.string().optional(),
  interactions: z.array(interactionSchema),
});

export type Cassette = z.infer<typeof cassetteSchema>;
export type CassetteMode = 'replay' | 'record';

const KEPT_RESPONSE_HEADERS = new Set(['content-type', 'retry-after']);
const SECRET_QUERY_PARAMS = /^(key|api[-_]?key|token|access[-_]?token)$/i;

export function emptyCassette(name: string): Cassette {
  return { version: 1, name, interactions: [] };
}

/** URL without credentials or key-like query parameters (Gemini accepts `?key=`). */
export function scrubUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    for (const name of [...parsed.searchParams.keys()]) if (SECRET_QUERY_PARAMS.test(name)) parsed.searchParams.delete(name);
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseBody(body: string | undefined): unknown {
  if (body === undefined) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

export class CassetteHttp implements HttpPort {
  private changed = false;

  constructor(
    readonly cassette: Cassette,
    private readonly mode: CassetteMode,
    private readonly hasher: Hasher,
    /** The real transport; required for recording. */
    private readonly inner?: HttpPort,
  ) {}

  /** True when recording added interactions that should be saved. */
  get dirty(): boolean {
    return this.changed;
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    const url = scrubUrl(request.url);
    const body = parseBody(request.body);
    const key = await this.hasher.sha256(stableStringify({ method: request.method, url, body }));
    const recorded = this.cassette.interactions.find((interaction) => interaction.key === key);
    if (recorded) return { status: recorded.response.status, headers: { ...recorded.response.headers }, text: recorded.response.text };

    if (this.mode === 'replay' || !this.inner) {
      throw new Error(`Cassette "${this.cassette.name}" has no response for ${request.method} ${url}. Re-record it against a live provider.`);
    }
    const response = await this.inner.request(request);
    const headers = Object.fromEntries(Object.entries(response.headers).filter(([name]) => KEPT_RESPONSE_HEADERS.has(name.toLowerCase())));
    this.cassette.interactions.push({ key, request: { method: request.method, url, body }, response: { status: response.status, headers, text: response.text } });
    this.changed = true;
    return response;
  }
}

/** Patterns that must never appear in a committed cassette. */
export const SECRET_PATTERNS: RegExp[] = [/\bsk-[A-Za-z0-9_-]{8,}/, /\bsk-ant-[A-Za-z0-9_-]{8,}/, /Bearer\s+[A-Za-z0-9._-]{8,}/i, /x-api-key/i, /authorization/i, /AIza[0-9A-Za-z_-]{20,}/];
