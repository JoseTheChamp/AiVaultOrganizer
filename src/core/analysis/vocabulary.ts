/**
 * Folder names people use for well-known roles, in English and Czech, normalized with
 * `normalizeFolderLabel`. Used to detect methods and to recognize system folders.
 */
export type FolderRole =
  | 'inbox'
  | 'projects'
  | 'areas'
  | 'resources'
  | 'archive'
  | 'atlas'
  | 'calendar'
  | 'efforts'
  | 'fleeting'
  | 'literature'
  | 'permanent'
  | 'references'
  | 'clippings'
  | 'daily'
  | 'categories'
  | 'attachments'
  | 'templates';

const VOCABULARY: Record<FolderRole, string[]> = {
  inbox: ['inbox', 'capture', 'unsorted', 'unprocessed', 'dorucene', 'prichozi', 'k zpracovani', 'nezpracovane'],
  projects: ['projects', 'project', 'projekty', 'projekt'],
  areas: ['areas', 'area', 'areas of responsibility', 'oblasti', 'oblast'],
  resources: ['resources', 'resource', 'zdroje', 'zdroj'],
  archive: ['archive', 'archives', 'archived', 'archiv'],
  atlas: ['atlas'],
  calendar: ['calendar', 'kalendar'],
  efforts: ['efforts', 'effort', 'usili'],
  fleeting: ['fleeting', 'fleeting notes', 'pomijive', 'prchave'],
  literature: ['literature', 'literature notes', 'literatura', 'literarni'],
  permanent: ['permanent', 'permanent notes', 'zettel', 'zettels', 'zettelkasten', 'slipbox', 'slip box', 'trvale'],
  references: ['references', 'reference', 'odkazy'],
  clippings: ['clippings', 'clipping', 'clips', 'web clips', 'vystrizky'],
  daily: ['daily', 'daily notes', 'dailies', 'journal', 'journals', 'denik', 'deniky', 'denni poznamky'],
  categories: ['categories', 'category', 'kategorie'],
  attachments: ['attachments', 'attachment', 'assets', 'files', 'media', 'images', 'prilohy', 'obrazky', 'soubory'],
  templates: ['templates', 'template', 'sablony', 'sablona'],
};

const BY_LABEL = new Map<string, FolderRole>();
for (const [role, labels] of Object.entries(VOCABULARY) as [FolderRole, string[]][]) {
  for (const label of labels) BY_LABEL.set(label, role);
}

/**
 * Folder name without numbering, emoji or diacritics: `1 Projects`, `01 - Projects`, `1. Projekty`
 * and `📁 Projects` all become `projects` / `projekty`.
 */
export function normalizeFolderLabel(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/^\d+(?:[.\-_)\s]+)/u, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
}

export function folderRole(name: string): FolderRole | null {
  return BY_LABEL.get(normalizeFolderLabel(name)) ?? null;
}

/** Roles that hold infrastructure rather than knowledge; topic detection skips them. */
export const SYSTEM_ROLES: ReadonlySet<FolderRole> = new Set(['attachments', 'templates', 'daily', 'inbox', 'archive']);
