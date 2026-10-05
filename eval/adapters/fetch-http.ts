import type { HttpPort, HttpRequest, HttpResponse } from '../../src/core/ports';

/**
 * HttpPort over Node's fetch, for the eval CLI and cassette recording. Plugin code never uses
 * fetch (Obsidian's requestUrl adapter does that job); Node tooling may.
 */
export class FetchHttp implements HttpPort {
  async request(request: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 120_000);
    try {
      const response = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, signal: controller.signal });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => (headers[name] = value));
      return { status: response.status, headers, text: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  }
}
