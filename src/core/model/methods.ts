/** Organization methods the plugin recognizes and ships presets for. */
export const METHOD_IDS = ['para', 'johnny-decimal', 'ace', 'zettelkasten', 'flat-categories', 'topics'] as const;

export type MethodId = (typeof METHOD_IDS)[number];

export const METHOD_LABELS: Record<MethodId, string> = {
  para: 'PARA',
  'johnny-decimal': 'Johnny.Decimal',
  ace: 'ACE',
  zettelkasten: 'Zettelkasten',
  'flat-categories': 'Flat + categories',
  topics: 'Topic folders',
};
