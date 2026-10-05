import type { CharterInput, PresetId } from '../schema';

/** Languages presets ship folder names and prose for. Other vault languages fall back to English. */
export type Lang = 'en' | 'cs';

export interface Localized {
  en: string;
  cs: string;
}

export interface Preset {
  id: Exclude<PresetId, 'custom'>;
  label: string;
  /** One paragraph explaining the method; becomes the charter's overview section. */
  summary: Localized;
  /** How to tell destinations apart; given to the AI classifier (English, model-facing). */
  guidance: string;
  /** Default charter for a vault language. */
  build(lang: Lang): CharterInput;
}

export function toLang(language: string): Lang {
  return language.toLowerCase().startsWith('cs') ? 'cs' : 'en';
}

/** System folders and labels shared by several presets. */
export const COMMON: Record<Lang, { inbox: string; attachments: string; templates: string; daily: string; related: string }> = {
  en: { inbox: '0 Inbox', attachments: 'Attachments', templates: 'Templates', daily: 'Daily', related: '## Related' },
  cs: { inbox: '0 Inbox', attachments: 'Přílohy', templates: 'Šablony', daily: 'Deník', related: '## Související' },
};

/** Files no preset ever touches: templates and drawing plugins' Markdown files. */
export function defaultIgnore(templates: string): string[] {
  return [`${templates}/**`, '**/*.excalidraw.md'];
}
