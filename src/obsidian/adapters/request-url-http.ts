import { type App, requestUrl } from 'obsidian';
import { hostOf } from '../../core/ai/endpoint-url';
import { ProviderError } from '../../core/ai/types';
import type { HttpPort, HttpRequest, HttpResponse, SecretsPort } from '../../core/ports';

/**
 * HttpPort over Obsidian's `requestUrl` (the only HTTP the plugin uses; no fetch, no CORS issues).
 * Non-2xx responses are returned, not thrown, so clients can read error bodies; a timeout aborts
 * waiting with a typed error.
 */
export class RequestUrlHttp implements HttpPort {
  async request(request: HttpRequest): Promise<HttpResponse> {
    const timeoutMs = request.timeoutMs ?? 120_000;
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(
        () => reject(new ProviderError('timeout', `No response from ${hostOf(request.url)} within ${Math.round(timeoutMs / 1000)} s.`)),
        timeoutMs,
      );
    });
    try {
      const response = await Promise.race([
        requestUrl({ url: request.url, method: request.method, headers: request.headers, body: request.body, throw: false }),
        timeout,
      ]);
      return { status: response.status, headers: response.headers, text: response.text };
    } finally {
      window.clearTimeout(timer);
    }
  }
}

/** API keys from Obsidian's SecretStorage (device-local keychain), looked up by name. */
export class ObsidianSecrets implements SecretsPort {
  constructor(private readonly app: App) {}

  async get(name: string): Promise<string | null> {
    if (!name) return null;
    return this.app.secretStorage.getSecret(name);
  }
}

/** Popout-safe sleep for retries and rate limits. */
export function windowSleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
