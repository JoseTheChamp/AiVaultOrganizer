import { describe, expect, it } from 'vitest';
import { ProviderError } from './types';

describe('ProviderError.fromStatus', () => {
  it('classifies statuses and honors Retry-After', () => {
    expect(ProviderError.fromStatus(401, 'bad key')).toMatchObject({ kind: 'auth', retryable: false });
    const limited = ProviderError.fromStatus(429, '', { 'Retry-After': '7' });
    expect(limited).toMatchObject({ kind: 'rate-limit', retryAfterMs: 7000, retryable: true });
    expect(ProviderError.fromStatus(503, 'down')).toMatchObject({ kind: 'server', retryable: true });
    expect(ProviderError.fromStatus(400, 'no')).toMatchObject({ kind: 'bad-request', retryable: false });
  });

  it('keeps error messages short and single-line', () => {
    const error = ProviderError.fromStatus(500, `line one\n${'x'.repeat(1000)}`);
    expect(error.message.length).toBeLessThan(400);
    expect(error.message).not.toContain('\n');
  });
});
