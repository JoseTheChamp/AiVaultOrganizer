import { COMMON, defaultIgnore, type Lang, type Preset } from './types';

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    projects: '1 Projects',
    areas: '2 Areas',
    resources: '3 Resources',
    archive: '4 Archive',
    projectsDescription: 'Active projects with a clear goal and an end.',
    areasDescription: 'Ongoing responsibilities that never end (health, finances, work).',
    resourcesDescription: 'Topics of interest and reference material that need no action.',
    archiveDescription: 'Inactive items from the other categories.',
  },
  cs: {
    projects: '1 Projekty',
    areas: '2 Oblasti',
    resources: '3 Zdroje',
    archive: '4 Archiv',
    projectsDescription: 'Aktivní projekty s jasným cílem a koncem.',
    areasDescription: 'Dlouhodobé odpovědnosti, které nekončí (zdraví, finance, práce).',
    resourcesDescription: 'Témata zájmu a referenční materiál bez akce.',
    archiveDescription: 'Neaktivní věci z ostatních kategorií.',
  },
};

export const para: Preset = {
  id: 'para',
  label: 'PARA',
  summary: {
    en: 'This vault uses **PARA** (Tiago Forte): notes are organized by how actionable they are. Projects have a goal and an end, areas are ongoing responsibilities, resources are topics of interest, and the archive holds whatever became inactive.',
    cs: 'Tento vault používá metodu **PARA** (Tiago Forte): poznámky třídíme podle toho, jak moc jsou akční. Projekty mají cíl a konec, oblasti jsou dlouhodobé odpovědnosti, zdroje jsou témata zájmu a archiv obsahuje vše, co přestalo být aktivní.',
  },
  guidance:
    'Projects have a concrete goal and an end; areas are ongoing responsibilities without an end; resources are reference material and topics of interest that need no action; the archive holds finished or inactive items. Reusable knowledge belongs in resources even when it came from a finished project.',
  build(lang: Lang) {
    const t = TEXT[lang];
    const c = COMMON[lang];
    return {
      version: 1,
      revision: 1,
      preset: 'para',
      language: lang,
      mode: 'folders',
      inbox: c.inbox,
      destinations: [
        {
          id: 'projects',
          path: t.projects,
          description: t.projectsDescription,
          layout: 'subfolder-per-item',
          match: [{ property: 'type', equals: 'project' }],
        },
        {
          id: 'areas',
          path: t.areas,
          description: t.areasDescription,
          layout: 'subfolder-per-item',
          match: [{ property: 'type', equals: 'area' }],
        },
        {
          id: 'resources',
          path: t.resources,
          description: t.resourcesDescription,
          layout: 'subfolder-per-topic',
          match: [{ property: 'type', equals: 'resource' }],
        },
        {
          id: 'archive',
          path: t.archive,
          description: t.archiveDescription,
          // A finished project is archived even though its type still says "project".
          priority: 10,
          match: [{ property: 'status', equals: ['done', 'archived'] }],
        },
      ],
      system: { attachments: c.attachments, templates: c.templates, daily: { path: c.daily, filename: 'YYYY-MM-DD' } },
      ignore: defaultIgnore(c.templates),
      conventions: {
        properties: { required: [], enums: { type: ['project', 'area', 'resource', 'note', 'daily', 'meeting'] } },
        links: { relatedHeading: c.related },
      },
      drift: { inboxMaxAgeDays: 14, checkOnStartup: false },
    };
  },
};
