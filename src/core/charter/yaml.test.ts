import { describe, expect, it } from 'vitest';
import { charterFingerprint, parseCharterYaml, setCharterRevision, stringifyCharter } from './yaml';

/** The example from PLAN §3.3, verbatim. */
const planExample = `version: 1
revision: 3
preset: para
language: cs
mode: folders
inbox: "0 Inbox"
destinations:
  - id: projects
    path: "1 Projekty"
    description: "Aktivní projekty s jasným cílem a koncem."
    layout: subfolder-per-item
    match: [{ property: type, equals: project }]
  - id: areas
    path: "2 Oblasti"
    description: "Dlouhodobé odpovědnosti, které nekončí (zdraví, finance, práce)."
    layout: subfolder-per-item
  - id: resources
    path: "3 Zdroje"
    description: "Témata zájmu a referenční materiál bez akce."
    layout: subfolder-per-topic
  - id: archive
    path: "4 Archiv"
    description: "Neaktivní věci z ostatních kategorií."
    layout: flat
    match: [{ property: status, equals: [done, archived] }]
system:
  attachments: "Přílohy"
  templates: "Šablony"
  daily: { path: "Deník", filename: "YYYY-MM-DD" }
ignore: ["Šablony/**", "**/*.excalidraw.md"]
conventions:
  properties: { required: [type, created], enums: { type: [project, area, resource, note, daily, meeting] } }
  tags: { style: lowercase-kebab, nested: true, maxPerNote: 5 }
  links: { relatedHeading: "## Související", minOutgoing: 1 }
mocs: { enabled: true, perDestination: true }
drift: { inboxMaxAgeDays: 14, checkOnStartup: true }
`;

describe('parseCharterYaml', () => {
  it('accepts the example charter from the plan', () => {
    const result = parseCharterYaml(planExample);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const charter = result.value;
    expect(charter).toMatchObject({ revision: 3, preset: 'para', language: 'cs', inbox: '0 Inbox' });
    expect(charter.destinations.map((d) => d.id)).toEqual(['projects', 'areas', 'resources', 'archive']);
    expect(charter.destinations[3]?.match).toEqual([{ property: 'status', equals: ['done', 'archived'] }]);
    expect(charter.destinations[1]).toMatchObject({ priority: 0, match: [], examples: [] });
    expect(charter.system.daily).toEqual({ path: 'Deník', filename: 'YYYY-MM-DD' });
  });

  it('reports YAML syntax errors with a line number', () => {
    const result = parseCharterYaml('version: 1\npreset: [para\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.line).toBeGreaterThan(0);
  });

  it('reports schema errors with path and line', () => {
    const yaml = planExample.replace('    path: "2 Oblasti"\n', '    path: "/2 Oblasti/"\n').replace('preset: para', 'preset: pera');
    const result = parseCharterYaml(yaml);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byPath = Object.fromEntries(result.error.map((issue) => [issue.path, issue]));
    expect(byPath.preset?.line).toBe(3);
    expect(byPath['destinations.1.path']).toMatchObject({ line: 14 });
  });

  it('rejects unknown keys, duplicate ids, missing paths and bad regexes', () => {
    const issues = (yaml: string) => {
      const result = parseCharterYaml(yaml);
      return result.ok ? [] : result.error.map((issue) => `${issue.path}: ${issue.message}`);
    };
    const base = 'version: 1\npreset: custom\ndestinations:\n';
    expect(issues(`${base}  - { id: a, path: A, colour: red }`).join()).toContain('colour');
    expect(issues(`${base}  - { id: a, path: A }\n  - { id: a, path: B }`)).toContain('destinations.1.id: duplicate destination id "a"');
    expect(issues(`${base}  - { id: a }`)).toContain('destinations.0: needs a path (or a category in hybrid mode)');
    expect(issues(`${base}  - { id: a, path: A, match: [{ filename: "([" }] }`).join()).toContain('valid regular expression');
    expect(issues(`${base}  - { id: Bad Id, path: A }`).join()).toContain('lowercase');
    expect(issues(`${base}  - { id: a, path: A, fallback: true }\n  - { id: b, path: B, fallback: true }`)).toContain(
      'destinations.1.fallback: only one destination can be the fallback ("a" already is)',
    );
    expect(issues('version: 1\npreset: custom\ninbox: In\ndestinations:\n  - { id: a, path: In }')).toContain(
      'destinations.0.path: must differ from the inbox folder',
    );
  });

  it('checks Johnny.Decimal categories against their area range', () => {
    const yaml = `version: 1\npreset: johnny-decimal\ndestinations: [{ id: a, path: A }]\njd:\n  areas:\n    - id: 10-19\n      name: Finance\n      categories: [{ id: "21", name: Wrong }]\n`;
    const result = parseCharterYaml(yaml);
    expect(!result.ok && result.error[0]?.message).toBe('category 21 is outside area 10-19');
  });
});

describe('stringifyCharter', () => {
  it('round-trips and reads like a hand-written charter', () => {
    const parsed = parseCharterYaml(planExample);
    if (!parsed.ok) throw new Error('example must parse');
    const yaml = stringifyCharter(parsed.value);
    expect(parseCharterYaml(yaml)).toEqual(parsed);
    expect(yaml).toContain('match: [ { property: type, equals: project } ]');
    expect(yaml).toContain('daily: { path: Deník, filename: YYYY-MM-DD }');
    expect(yaml).toContain('ignore: [ Šablony/**, "**/*.excalidraw.md" ]');
    expect(yaml).not.toContain('priority');
    expect(yaml).not.toContain('examples');
    expect(yaml.indexOf('version')).toBe(0);
  });

  it('writes the fallback flag only where it is set', () => {
    const parsed = parseCharterYaml('version: 1\npreset: custom\ndestinations:\n  - { id: notes, path: Notes }\n  - { id: other, path: Other, fallback: true, description: Notes nothing else fits. }\n');
    if (!parsed.ok) throw new Error('must parse');
    const yaml = stringifyCharter(parsed.value);
    expect(yaml).toContain('- id: other\n    path: Other\n    fallback: true');
    expect(yaml.match(/fallback/g)).toHaveLength(1);
    expect(parseCharterYaml(yaml)).toEqual(parsed);
  });
});

describe('revisions and fingerprints', () => {
  it('bumps the revision without losing comments', () => {
    const withComment = planExample.replace('preset: para', 'preset: para # chosen in 2026');
    const bumped = setCharterRevision(withComment, 4);
    expect(bumped).toContain('revision: 4');
    expect(bumped).toContain('# chosen in 2026');
  });

  it('fingerprints meaning, not the revision number', () => {
    const a = parseCharterYaml(planExample);
    const b = parseCharterYaml(planExample.replace('revision: 3', 'revision: 9'));
    const c = parseCharterYaml(planExample.replace('inboxMaxAgeDays: 14', 'inboxMaxAgeDays: 7'));
    if (!a.ok || !b.ok || !c.ok) throw new Error('must parse');
    expect(charterFingerprint(a.value)).toBe(charterFingerprint(b.value));
    expect(charterFingerprint(a.value)).not.toBe(charterFingerprint(c.value));
  });
});
