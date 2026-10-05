/** Languages the plugin ships labels and folder names for. Others fall back to English. */
export type VaultLanguage = 'en' | 'cs';

export interface LanguageGuess {
  language: VaultLanguage;
  /** 0..1; low values mean the evidence was thin and the user should confirm. */
  confidence: number;
}

const CZECH_CHARS = /[ěščřžýáíéůúťďňó]/giu;
const CZECH_WORDS = new Set([
  'a', 'je', 'se', 'na', 'v', 've', 'že', 'to', 'jsem', 'pro', 'do', 'od', 'po', 'za', 'jak', 'co', 'ale',
  'nebo', 'jako', 'byl', 'by', 'bych', 'mám', 'není', 'také', 'když', 'už', 'jsou', 'k', 's', 'z', 'o', 'u',
  'poznámky', 'projekty', 'oblasti', 'zdroje', 'archiv', 'deník', 'šablony', 'přílohy', 'nápady', 'úkoly',
]);
const ENGLISH_WORDS = new Set([
  'the', 'and', 'of', 'to', 'is', 'in', 'for', 'with', 'on', 'that', 'this', 'it', 'as', 'are', 'be', 'or',
  'how', 'what', 'my', 'from', 'at', 'by', 'notes', 'projects', 'areas', 'resources', 'archive', 'daily',
  'templates', 'attachments', 'ideas', 'tasks', 'meeting', 'meetings', 'plan', 'review',
]);
const WORD = /\p{L}+/gu;

/**
 * Guesses whether a vault is written in Czech or English from short texts (titles, headings,
 * folder names). Deliberately simple: diacritics and stopwords separate the two well, and the
 * wizard always lets the user override the result.
 */
export function guessLanguage(texts: readonly string[]): LanguageGuess {
  let czech = 0;
  let english = 0;
  for (const text of texts) {
    czech += (text.match(CZECH_CHARS)?.length ?? 0) * 0.5;
    for (const word of text.toLowerCase().match(WORD) ?? []) {
      if (CZECH_WORDS.has(word)) czech += 1;
      if (ENGLISH_WORDS.has(word)) english += 1;
    }
  }
  const total = czech + english;
  if (total === 0) return { language: 'en', confidence: 0 };
  const language: VaultLanguage = czech > english ? 'cs' : 'en';
  const margin = Math.abs(czech - english) / total;
  const evidence = Math.min(1, total / 20);
  return { language, confidence: Math.round(margin * evidence * 100) / 100 };
}
