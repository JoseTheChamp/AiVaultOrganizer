import type { HttpPort, HttpRequest, HttpResponse } from '../ports';
import { hostOf, isLoopbackUrl } from './endpoint-url';
import { ProviderError } from './types';

/**
 * Network guard (invariant 5). Wraps the real transport, so no client can bypass it: in local-only
 * mode every request to a host other than this machine is refused before anything is sent, and
 * non-HTTP(S) URLs are always refused.
 */
export class LocalOnlyHttp implements HttpPort {
  constructor(
    private readonly inner: HttpPort,
    private readonly localOnly: () => boolean,
  ) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    const problem = endpointPolicyProblem(request.url, this.localOnly());
    if (problem) throw new ProviderError('blocked', problem);
    return this.inner.request(request);
  }
}

/** Why a request to this URL is not allowed, or null when it is. Also used by the settings UI. */
export function endpointPolicyProblem(url: string, localOnly: boolean): string | null {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return `"${url}" is not a valid URL.`;
  }
  if (protocol !== 'http:' && protocol !== 'https:') return `Only http and https endpoints are supported, not ${protocol}.`;
  if (localOnly && !isLoopbackUrl(url)) {
    return `Local-only mode blocks requests to ${hostOf(url)}. Turn it off in the settings to use a cloud provider.`;
  }
  return null;
}
