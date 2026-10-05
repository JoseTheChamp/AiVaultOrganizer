/**
 * True for URLs that point at this machine: localhost (and *.localhost), 127.0.0.0/8 and ::1.
 * Used to tell local providers from cloud ones and by local-only mode (invariant 5).
 */
export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  return /^127(?:\.\d{1,3}){3}$/.test(host);
}

/** Host name of a URL for messages and consent screens; the URL itself when unparsable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
