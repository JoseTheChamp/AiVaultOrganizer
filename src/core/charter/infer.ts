import type { VaultAnalysis } from '../analysis/analyze';
import { DATED_NAME } from '../analysis/stats';
import { folderRole, normalizeFolderLabel, type FolderRole } from '../analysis/vocabulary';
import type { MethodId } from '../model/methods';
import type { VaultSnapshot } from '../model/note';
import { fileName, isInFolder, parentFolder } from '../model/paths';
import { type Lang, presetCharter, toLang } from './presets/index';
import { defaultIgnore } from './presets/types';
import { type Charter, charterSchema, type Destination } from './schema';

const JD_RANGE = /^(\d{2})-(\d{2})\s+(.+)$/;
const JD_CATEGORY = /^(\d{2})\s+(.+)$/;

/**
 * Fits a preset to an existing vault: wherever the vault already has a folder playing the same role
 * (`Projects` for PARA's `1 Projects`, `Šablony` for templates), the charter uses that folder instead
 * of creating a parallel one. Nested folders are matched by role or name under their mapped parent.
 */
export function adaptPresetToVault(charter: Charter, snapshot: VaultSnapshot): Charter {
  if (charter.preset === 'johnny-decimal') {
    const derived = johnnyDecimalFromVault(snapshot, toLang(charter.language));
    if (derived) return derived;
  }
  const folders = new Set(snapshot.folders);
  const remap = (path: string | undefined) => (path === undefined ? undefined : mapFolder(path, folders, snapshot.folders));
  const templates = remap(charter.system.templates);
  const adapted = {
    ...charter,
    inbox: remap(charter.inbox),
    destinations: charter.destinations.map((destination) => ({ ...destination, path: remap(destination.path) })),
    system: {
      ...charter.system,
      attachments: remap(charter.system.attachments),
      templates,
      daily: charter.system.daily ? { ...charter.system.daily, path: remap(charter.system.daily.path) ?? charter.system.daily.path } : undefined,
    },
    ignore: templates && charter.system.templates ? charter.ignore.map((glob) => glob.replace(`${charter.system.templates}/`, `${templates}/`)) : charter.ignore,
  };
  return charterSchema.parse(adapted);
}

function mapFolder(path: string, existing: Set<string>, all: readonly string[]): string {
  if (existing.has(path)) return path;
  const segments = path.split('/');
  let mapped = '';
  for (const segment of segments) {
    const candidates = all.filter((folder) => parentFolder(folder) === mapped);
    const target = mapped === '' ? segment : `${mapped}/${segment}`;
    if (existing.has(target)) {
      mapped = target;
      continue;
    }
    const role = folderRole(segment);
    const label = normalizeFolderLabel(segment);
    const match =
      candidates.find((folder) => role !== null && folderRole(fileName(folder)) === role) ??
      candidates.find((folder) => normalizeFolderLabel(fileName(folder)) === label);
    mapped = match ?? target;
  }
  return mapped;
}

/**
 * "Codify my current structure" (PLAN §4): a charter that describes the vault as it is. It starts
 * from the detected method (with the vault's own folder names) when detection is clear, and keeps
 * every other top-level folder that holds notes as a destination, so a well-kept vault is
 * on-charter from the start and only stray notes show up as drift.
 */
export function inferCharter(snapshot: VaultSnapshot, analysis: VaultAnalysis, language?: Lang): Charter {
  const lang = language ?? (analysis.stats.language.confidence >= 0.2 ? analysis.stats.language.language : 'en');
  const dominant = analysis.methods.dominant;
  const known: MethodId | null = dominant !== 'none' && dominant !== 'mixed' && dominant !== 'topics' ? dominant : null;

  let base: Charter;
  if (known) {
    base = adaptPresetToVault(presetCharter(known, lang), snapshot);
  } else {
    base = adaptPresetToVault(presetCharter('topics', lang), snapshot);
    base = { ...base, preset: dominant === 'topics' ? 'topics' : 'custom', destinations: [] };
  }

  // Keep existing destinations only where the vault has the folder; then add the vault's other folders.
  const existing = new Set(snapshot.folders);
  const destinations: Destination[] = base.destinations.filter((d) => d.path === undefined || existing.has(d.path));
  const covered = (folder: string) =>
    [base.inbox, base.system.attachments, base.system.templates, base.system.daily?.path, ...destinations.map((d) => d.path)].some(
      (path) => path !== undefined && (isInFolder(folder, path) || isInFolder(path, folder)),
    );
  const ids = new Set(destinations.map((d) => d.id));
  for (const usage of analysis.stats.topLevelFolders) {
    const role = folderRole(usage.path);
    if (usage.noteCount === 0 || covered(usage.path) || (role !== null && SYSTEM_LIKE.has(role))) continue;
    destinations.push(topicDestination(usage.path, snapshot, lang, ids));
  }

  const system = detectSystemFolders(snapshot, base);
  const inbox = topLevelWithRole(snapshot, 'inbox') ?? (base.inbox && existing.has(base.inbox) ? base.inbox : undefined);

  if (destinations.length === 0) {
    // Nothing to codify (e.g. everything in the root): the flat preset describes that best.
    return adaptPresetToVault(presetCharter('flat-categories', lang), snapshot);
  }
  return charterSchema.parse({
    ...base,
    language: lang,
    inbox,
    destinations,
    system,
    ignore: system.templates ? defaultIgnore(system.templates) : ['**/*.excalidraw.md'],
  });
}

const SYSTEM_LIKE: ReadonlySet<FolderRole> = new Set(['attachments', 'templates', 'daily', 'inbox']);

function topicDestination(folder: string, snapshot: VaultSnapshot, lang: Lang, ids: Set<string>): Destination {
  const notes = snapshot.notes.filter((note) => isInFolder(note.path, folder));
  const hasSubfolders = notes.some((note) => parentFolder(note.path) !== folder);
  const examples = [...notes]
    .sort((a, b) => b.inLinks.length - a.inLinks.length || a.path.localeCompare(b.path))
    .slice(0, 3)
    .map((note) => note.path);
  const subtopics = snapshot.folders.filter((f) => parentFolder(f) === folder).map(fileName).slice(0, 4);
  const description =
    lang === 'cs'
      ? `Poznámky k tématu ${folder}${subtopics.length > 0 ? ` (např. ${subtopics.join(', ')})` : ''}.`
      : `Notes about ${folder}${subtopics.length > 0 ? ` (for example ${subtopics.join(', ')})` : ''}.`;
  return {
    id: uniqueId(slug(folder), ids),
    path: folder,
    description,
    layout: hasSubfolders ? 'subfolder-per-topic' : 'flat',
    priority: 0,
    match: [],
    examples,
  };
}

function detectSystemFolders(snapshot: VaultSnapshot, base: Charter): Charter['system'] {
  const existing = new Set(snapshot.folders);
  const keep = (path: string | undefined) => (path !== undefined && existing.has(path) ? path : undefined);
  const attachments = topLevelWithRole(snapshot, 'attachments') ?? keep(base.system.attachments) ?? busiestAttachmentFolder(snapshot);
  const templates = topLevelWithRole(snapshot, 'templates') ?? keep(base.system.templates);
  const dailyPath = topLevelWithRole(snapshot, 'daily') ?? keep(base.system.daily?.path) ?? busiestDatedFolder(snapshot);
  return {
    attachments,
    templates,
    daily: dailyPath ? { path: dailyPath, filename: detectDateFormat(snapshot, dailyPath) } : undefined,
  };
}

function topLevelWithRole(snapshot: VaultSnapshot, role: FolderRole): string | undefined {
  return snapshot.folders.find((folder) => parentFolder(folder) === '' && folderRole(folder) === role);
}

function busiestAttachmentFolder(snapshot: VaultSnapshot): string | undefined {
  return busiest(snapshot.otherFiles.filter((file) => !['canvas', 'base'].includes(file.extension)).map((file) => parentFolder(file.path)));
}

function busiestDatedFolder(snapshot: VaultSnapshot): string | undefined {
  return busiest(snapshot.notes.filter((note) => DATED_NAME.test(note.basename)).map((note) => note.folder), 3);
}

function busiest(folders: string[], minimum = 1): string | undefined {
  const counts = new Map<string, number>();
  for (const folder of folders) if (folder !== '') counts.set(folder, (counts.get(folder) ?? 0) + 1);
  const [best] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return best && best[1] >= minimum ? best[0] : undefined;
}

function detectDateFormat(snapshot: VaultSnapshot, folder: string): string {
  const names = snapshot.notes.filter((note) => note.folder === folder).map((note) => note.basename);
  const compact = names.filter((name) => /^\d{8}$/.test(name)).length;
  const dashed = names.filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).length;
  return compact > dashed ? 'YYYYMMDD' : 'YYYY-MM-DD';
}

/** Johnny.Decimal charter built from the vault's own `NN-NN Area/NN Category` folders. */
function johnnyDecimalFromVault(snapshot: VaultSnapshot, lang: Lang): Charter | null {
  const areas = snapshot.folders
    .filter((folder) => parentFolder(folder) === '' && JD_RANGE.test(folder))
    .map((folder) => {
      const [, low = '', high = '', name = folder] = JD_RANGE.exec(folder) ?? [];
      const categories = snapshot.folders
        .filter((child) => parentFolder(child) === folder && JD_CATEGORY.test(fileName(child)))
        .map((child) => {
          const [, id = '', categoryName = ''] = JD_CATEGORY.exec(fileName(child)) ?? [];
          return { id, name: categoryName, path: child };
        })
        .filter((category) => Number(category.id) >= Number(low) && Number(category.id) <= Number(high));
      return { id: `${low}-${high}`, name, categories };
    })
    .filter((area) => area.categories.length > 0);
  if (areas.length === 0) return null;
  const preset = presetCharter('johnny-decimal', lang);
  return charterSchema.parse({
    ...preset,
    inbox: topLevelWithRole(snapshot, 'inbox'),
    destinations: areas.flatMap((area) =>
      area.categories.map((category) => ({
        id: `jd-${category.id}`,
        path: category.path,
        description: `${area.name}: ${category.name}`,
        match: [{ filename: `^${category.id}\\.\\d{2}(?:\\s|$)` }],
      })),
    ),
    system: { attachments: topLevelWithRole(snapshot, 'attachments'), templates: topLevelWithRole(snapshot, 'templates') },
    jd: { areas: areas.map((area) => ({ id: area.id, name: area.name, categories: area.categories.map(({ id, name }) => ({ id, name })) })) },
  });
}

export function slug(text: string): string {
  const cleaned = text
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return /^[a-z0-9]/.test(cleaned) ? cleaned : `d-${cleaned || 'folder'}`;
}

function uniqueId(base: string, ids: Set<string>): string {
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  ids.add(id);
  return id;
}
