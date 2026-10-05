import type { HttpPort, HttpRequest, HttpResponse, SecretsPort } from '../ports';

type Handler = (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;

/** Scripted HttpPort for tests: routes by method and URL pattern, records every request. */
export class FakeHttp implements HttpPort {
  readonly requests: HttpRequest[] = [];
  private readonly routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

  on(method: 'GET' | 'POST', pattern: RegExp, handler: Handler): this {
    this.routes.push({ method, pattern, handler });
    return this;
  }

  /** Responds with JSON on a route. */
  json(method: 'GET' | 'POST', pattern: RegExp, body: unknown, status = 200, headers: Record<string, string> = {}): this {
    return this.on(method, pattern, () => ({ status, headers: { 'content-type': 'application/json', ...headers }, text: JSON.stringify(body) }));
  }

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const route = this.routes.find((candidate) => candidate.method === request.method && candidate.pattern.test(request.url));
    if (!route) throw new Error(`No fake route for ${request.method} ${request.url}`);
    return route.handler(request);
  }

  /** Parsed JSON body of the n-th request. */
  body(index = this.requests.length - 1): Record<string, unknown> {
    return JSON.parse(this.requests[index]?.body ?? '{}') as Record<string, unknown>;
  }
}

export class FakeSecrets implements SecretsPort {
  constructor(private readonly values: Record<string, string> = {}) {}

  async get(name: string): Promise<string | null> {
    return this.values[name] ?? null;
  }
}
