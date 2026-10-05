import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('returns defaults for missing data', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values', () => {
    expect(parseSettings({ charterPath: 'Meta/Charter.md', debugLogging: true, backupRetention: 3 })).toEqual({
      ...DEFAULT_SETTINGS,
      charterPath: 'Meta/Charter.md',
      debugLogging: true,
      backupRetention: 3,
    });
  });

  it('falls back per field when a value is invalid', () => {
    const parsed = parseSettings({ charterPath: '   ', debugLogging: true, backupRetention: 0 });
    expect(parsed.charterPath).toBe(DEFAULT_SETTINGS.charterPath);
    expect(parsed.backupRetention).toBe(10);
    expect(parsed.debugLogging).toBe(true);
  });

  it('drops unknown keys and never stores an API key, even inside AI settings', () => {
    expect(parseSettings({ apiKey: 'should-not-survive' })).not.toHaveProperty('apiKey');
    const parsed = parseSettings({ ai: { chat: { enabled: true, apiKey: 'sk-secret', secretName: 'openai' } } });
    expect(JSON.stringify(parsed)).not.toContain('sk-secret');
    expect(parsed.ai.chat).toMatchObject({ enabled: true, secretName: 'openai' });
  });

  it('falls back to default AI settings when they are corrupt', () => {
    expect(parseSettings({ ai: 'garbage' }).ai.localOnly).toBe(true);
  });
});
