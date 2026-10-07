import { configFromPreset, ENDPOINT_PRESETS, type EndpointPreset, findPreset } from './config';
import type { AiSettings } from './settings';

/** What the guided AI setup asks: where the model runs, and which one. */
export type AiSetup =
  | { mode: 'none' }
  | { mode: 'local'; preset: string; model: string; similarity: boolean }
  | { mode: 'cloud'; preset: string; model: string; secretName: string };

/** Providers the guided setup offers; the settings tab has the rest (custom endpoints, URLs). */
export const LOCAL_PROVIDERS: EndpointPreset[] = ENDPOINT_PRESETS.filter((preset) => preset.local);
export const CLOUD_PROVIDERS: EndpointPreset[] = ENDPOINT_PRESETS.filter((preset) => !preset.local && preset.id !== 'custom');

/** The keychain entry the guided setup stores a provider's key under (lowercase, dashes). */
export function secretNameFor(preset: string): string {
  return `ai-vault-organizer-${preset.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

/** The choice the current settings amount to, to start the dialog from. */
export function currentSetup(ai: AiSettings): AiSetup {
  if (!ai.chat.enabled) return { mode: 'none' };
  const preset = findPreset(ai.chat.preset);
  if (preset?.local) return { mode: 'local', preset: preset.id, model: ai.chat.model, similarity: ai.embeddings.enabled };
  return { mode: 'cloud', preset: ai.chat.preset, model: ai.chat.model, secretName: ai.chat.secretName };
}

/**
 * Settings after the guided setup. Local keeps local-only mode on and can add similarity by meaning
 * with the provider's embedding model; a cloud provider turns local-only mode off, since its host
 * must be reachable (each run still asks before sending notes). No AI turns both models off.
 */
export function applyAiSetup(ai: AiSettings, setup: AiSetup): AiSettings {
  switch (setup.mode) {
    case 'none':
      return { ...ai, chat: { ...ai.chat, enabled: false }, embeddings: { ...ai.embeddings, enabled: false } };
    case 'local': {
      const preset = findPreset(setup.preset);
      if (!preset) return ai;
      const embeddings = setup.similarity ? { ...configFromPreset(preset, 'embeddings'), enabled: true } : { ...ai.embeddings, enabled: false };
      return { ...ai, localOnly: true, chat: { ...configFromPreset(preset, 'chat'), model: setup.model.trim() || preset.chatModel, enabled: true }, embeddings };
    }
    case 'cloud': {
      const preset = findPreset(setup.preset);
      if (!preset) return ai;
      return {
        ...ai,
        localOnly: false,
        chat: { ...configFromPreset(preset, 'chat', setup.secretName), model: setup.model.trim() || preset.chatModel, enabled: true },
      };
    }
  }
}
