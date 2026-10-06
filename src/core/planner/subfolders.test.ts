import { describe, expect, it } from 'vitest';
import { subfolderNamingV1 } from '../ai/prompts/subfolder-naming.v1';
import { presetCharter } from '../charter/presets';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { type Classification, classificationTargets, type Placement } from './classify';
import { createSubfolderNamer, folderKey, reconcileSubfolders } from './subfolders';

const charter = presetCharter('para', 'en');
const placed = (path: string, subfolder: string | null, source: Placement['source'] = 'llm', destination = 'projects'): Placement => ({
  path,
  destination,
  subfolder,
  confidence: 0.8,
  source,
  rationale: '',
  signals: {},
});

function classification(placements: Placement[]): Classification {
  return { placements: new Map(placements.map((p) => [p.path, p])), skipped: [], targets: classificationTargets(charter) };
}

const folders = ['1 Projects', '1 Projects/Website relaunch', '1 Projects/Home office setup', '3 Resources', '3 Resources/TypeScript'];

describe('folderKey', () => {
  it('folds case, diacritics, punctuation and plurals', () => {
    expect(folderKey('Website-Relaunch')).toBe(folderKey('website relaunch'));
    expect(folderKey('Stěhování do Brna')).toBe('stehovanidobrna');
    expect(folderKey('Recipes')).toBe(folderKey('Recipe'));
    expect(folderKey('Glass')).toBe('glass');
  });
});

describe('reconcileSubfolders', () => {
  it('joins existing folders whatever the spelling, and merges new spellings', async () => {
    const c = classification([
      placed('a.md', 'website-relaunch'),
      placed('b.md', 'Home Office Setup'),
      placed('c.md', 'Marathon training', 'knn'),
      placed('d.md', 'marathon-training'),
      placed('e.md', 'Marathon Trainings'),
      placed('f.md', 'Typescript', 'llm', 'resources'),
      placed('g.md', null),
    ]);
    const report = await reconcileSubfolders(c, charter, folders);
    const sub = (path: string) => c.placements.get(path)?.subfolder;
    expect([sub('a.md'), sub('b.md'), sub('f.md')]).toEqual(['Website relaunch', 'Home office setup', 'TypeScript']);
    // kNN's spelling outweighs the model's.
    expect([sub('c.md'), sub('d.md'), sub('e.md')]).toEqual(['Marathon training', 'Marathon training', 'Marathon training']);
    expect(sub('g.md')).toBeNull();
    expect(report).toEqual({ reused: 3, merged: 5, created: 1 });
  });

  it('joins a typo of an existing folder, but not a longer name that starts the same', async () => {
    const c = classification([placed('a.md', 'Webstie relaunch'), placed('b.md', 'Home office setup and garage')]);
    await reconcileSubfolders(c, charter, folders);
    expect(c.placements.get('a.md')?.subfolder).toBe('Website relaunch');
    expect(c.placements.get('b.md')?.subfolder).toBe('Home office setup and garage');
  });

  it('lets a namer rename new folders, or send them into an existing one', async () => {
    const c = classification([placed('a.md', 'Run stuff'), placed('b.md', 'Websites')]);
    const report = await reconcileSubfolders(c, charter, folders, async (request) => {
      expect(request.existing).toEqual(['Home office setup', 'Website relaunch']);
      return new Map([[request.proposals[0]?.key ?? '', 'Half marathon']]);
    });
    expect(c.placements.get('a.md')?.subfolder).toBe('Half marathon');
    expect(report.created).toBe(2);
  });
});

describe('subfolder-naming v1', () => {
  const input = {
    language: 'en' as const,
    destination: { id: 'projects', description: 'Active projects.' },
    existing: ['Website relaunch'],
    proposals: [{ key: 'f1', name: 'Run stuff', notes: ['Long run log', 'Race pace strategy'] }],
  };

  it('renders a stable prompt', () => {
    expect(subfolderNamingV1.build(input)).toMatchSnapshot();
  });

  it('names through the model and keeps the proposals when it fails', async () => {
    const good = createSubfolderNamer(new ScriptedChatProvider([JSON.stringify({ folders: [{ key: 'f1', name: 'Half marathon' }] })]), 'en');
    expect(await good.namer({ destination: input.destination, existing: input.existing, proposals: [{ key: 'runstuff', name: 'Run stuff', notes: [] }] })).toEqual(new Map([['runstuff', 'Half marathon']]));
    const bad = createSubfolderNamer(new ScriptedChatProvider(['?', '?']), 'en');
    expect(await bad.namer({ destination: input.destination, existing: [], proposals: [{ key: 'x', name: 'X', notes: [] }] })).toEqual(new Map());
    expect(bad.stats).toEqual({ calls: 2, failures: 1 });
  });
});
