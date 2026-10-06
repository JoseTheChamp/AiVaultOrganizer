import { mulberry32, pick, sample } from './random';
import { FILLER, type TopicMaterial, TOPICS } from './topics';

export interface TopicVaultOptions {
  notes: number;
  seed: number;
  /** Share of notes written in Czech (0..1). */
  czechShare: number;
}

export interface TopicVault {
  /** Vault-relative path → Markdown content. */
  files: Record<string, string>;
  /** Vault-relative path → topic id: the ground truth for similarity checks. */
  topics: Record<string, string>;
  /** Vault-relative path → language the note is written in. */
  languages: Record<string, 'en' | 'cs'>;
}

export const DEFAULT_TOPIC_VAULT: TopicVaultOptions = { notes: 600, seed: 1, czechShare: 0.3 };

/**
 * A seeded synthetic vault for similarity checks: notes about ten topics in English and Czech,
 * scattered over folders that don't reveal the topic, with filler sentences, an occasional sentence
 * from another topic, tags and links. The same options always produce the same vault.
 */
export function generateTopicVault(options: Partial<TopicVaultOptions> = {}): TopicVault {
  const { notes, seed, czechShare } = { ...DEFAULT_TOPIC_VAULT, ...options };
  const random = mulberry32(seed);
  const files: Record<string, string> = {};
  const topics: Record<string, string> = {};
  const languages: Record<string, 'en' | 'cs'> = {};
  const byTopic = new Map<string, string[]>();
  const folders = ['', 'Notes', 'Inbox', 'Notes/Older'];

  for (let i = 0; i < notes; i++) {
    const topic = TOPICS[i % TOPICS.length] as TopicMaterial;
    const language = random() < czechShare ? 'cs' : 'en';
    const material = topic[language];
    const folder = pick(random, folders);
    const title = uniqueTitle(`${pick(random, material.titles)} ${1 + Math.floor(i / TOPICS.length)}`, folder, files);
    const path = folder ? `${folder}/${title}.md` : `${title}.md`;

    const sentences = sample(random, material.sentences, 3 + Math.floor(random() * 5));
    if (random() < 0.5) sentences.push(pick(random, FILLER[language]));
    if (random() < 0.2) {
      const other = TOPICS[(i + 1 + Math.floor(random() * (TOPICS.length - 1))) % TOPICS.length] as TopicMaterial;
      sentences.splice(Math.floor(random() * sentences.length), 0, pick(random, other[language].sentences));
    }

    const lines: string[] = [];
    if (random() < 0.4) lines.push('---', `tags: [${pick(random, material.tags)}]`, '---');
    if (random() < 0.5) {
      const half = Math.ceil(sentences.length / 2);
      lines.push(`## ${pick(random, material.titles)}`, sentences.slice(0, half).join(' '), '', sentences.slice(half).join(' '));
    } else {
      lines.push(sentences.join(' '));
    }
    // Links stay within a language, so word overlap across languages comes only from shared names.
    const siblings = byTopic.get(`${topic.id}/${language}`) ?? [];
    if (siblings.length > 0 && random() < 0.3) lines.push('', `Related: [[${pick(random, siblings)}]]`);
    if (random() < 0.3) lines.push('', `#${pick(random, material.tags)}`);

    files[path] = `${lines.join('\n')}\n`;
    topics[path] = topic.id;
    languages[path] = language;
    byTopic.set(`${topic.id}/${language}`, [...siblings, title]);
  }
  return { files, topics, languages };
}

function uniqueTitle(raw: string, folder: string, files: Record<string, string>): string {
  // Characters that are illegal in file names on some systems or special in Obsidian links.
  const title = raw.replace(/[\\/:*?"<>|#^[\]]/g, '-');
  let candidate = title;
  for (let n = 2; `${folder ? `${folder}/` : ''}${candidate}.md` in files; n++) candidate = `${title} (${n})`;
  return candidate;
}
