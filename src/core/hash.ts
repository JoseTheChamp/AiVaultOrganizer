import type { Hasher } from './ports';

const encoder = new TextEncoder();

/**
 * SHA-256 via the Web Crypto API, which exists both in Obsidian (Electron) and in Node ≥ 20,
 * so the same implementation serves every adapter.
 */
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return toHex(new Uint8Array(digest));
}

export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

export const webCryptoHasher: Hasher = { sha256: sha256Hex };
