/**
 * Guard for invariant 6: no committed cassette may contain anything that looks like a credential.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cassetteSchema, SECRET_PATTERNS } from '../src/core/ai/cassette';
import { CASSETTE_DIR } from './adapters/cassette-files';

const files = (() => {
  try {
    return readdirSync(CASSETTE_DIR).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
})();

describe('committed cassettes', () => {
  it.each(files.length > 0 ? files : ['(none yet)'])('%s is valid and free of secrets', (name) => {
    if (name === '(none yet)') return;
    const text = readFileSync(path.join(CASSETTE_DIR, name), 'utf8');
    expect(cassetteSchema.safeParse(JSON.parse(text)).success).toBe(true);
    for (const pattern of SECRET_PATTERNS) expect(pattern.test(text), `${name} matches ${pattern}`).toBe(false);
  });
});
