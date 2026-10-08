import { describe, expect, it } from 'vitest';
import { statusView } from './ai-status';

describe('statusView', () => {
  it('reads every state as a label, a tone and what to do', () => {
    expect(statusView({ state: 'online', model: 'qwen3:8b', latencyMs: 9 })).toEqual({ label: 'Online', tone: 'ok', problem: null });
    expect(statusView({ state: 'missing-model', model: 'qwen3:8b', available: ['llama3'] })).toMatchObject({ tone: 'warn', problem: expect.stringContaining('"qwen3:8b" is not available') as string });
    expect(statusView({ state: 'offline', message: 'Could not reach http://localhost:11434/v1.' })).toEqual({
      label: 'Offline',
      tone: 'error',
      problem: 'The model does not answer (Could not reach http://localhost:11434/v1). Start its app, or check Set up AI.',
    });
    expect(statusView({ state: 'blocked', message: 'Local-only mode blocks api.openai.com.' }).tone).toBe('error');
    expect(statusView({ state: 'off' }).tone).toBe('off');
  });
});
