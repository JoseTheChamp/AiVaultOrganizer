import type { MethodId } from '../../model/methods';

/** What a method is, for someone choosing one: shown in the setup wizard (English, like the UI). */
export interface MethodAbout {
  /** Who made it known, if anyone. */
  origin: string | null;
  /** One line under the method's name. */
  tagline: string;
  /** Two or three sentences behind "About". */
  description: string;
  goodFor: string[];
  notFor: string[];
}

export const METHOD_ABOUT: Record<MethodId, MethodAbout> = {
  para: {
    origin: 'Tiago Forte',
    tagline: 'Sort by how actionable a note is: projects, areas, resources, archive.',
    description:
      'Four top folders. Projects have a goal and an end, areas are ongoing responsibilities such as health or finances, resources are topics of interest, and the archive takes whatever is no longer active.',
    goodFor: ['Many projects that start and finish', 'A small, fixed set of top folders', 'Getting finished work out of sight'],
    notFor: ['A personal wiki of knowledge (it all lands in Resources)', 'Notes that belong to no project or area'],
  },
  ace: {
    origin: 'Nick Milo, Linking Your Thinking',
    tagline: 'Sort by intention: Atlas to know, Calendar for time, Efforts to act.',
    description:
      'Atlas holds knowledge (maps of content, notes, sources, people), Calendar holds dated notes and meetings, and Efforts holds projects and areas, sorted by how much attention they get now: on, ongoing, simmering, sleeping.',
    goodFor: ['Linked thinking with maps of content', 'A mix of journals, meetings and projects', 'Seeing what gets your attention'],
    notFor: ['Wanting few decisions per note (it has more places than PARA)', 'Vaults with no dated notes or projects'],
  },
  'flat-categories': {
    origin: 'Steph Ango',
    tagline: 'Almost no folders: a categories property says what each note is.',
    description:
      'Your own notes stay in the vault root and link to category notes such as [[Books]] or [[People]], whose views list their members. Folders are only for things from outside: references, clippings, daily notes, attachments.',
    goodFor: ['Linking and searching rather than browsing', 'Properties and Bases', 'Never asking "which folder?"'],
    notFor: ['Browsing by folder', 'Sharing a folder of notes with others'],
  },
  'johnny-decimal': {
    origin: 'Johnny Noble',
    tagline: 'Numbered areas and categories; every note gets an ID such as 11.03.',
    description:
      'Up to ten areas (10-19, 20-29…) of up to ten categories each. Every item gets a permanent number, so you can find and cite it without searching. The index of numbers is the map of everything.',
    goodFor: ['Admin, records and reference you look up', 'A structure that rarely changes', 'Sharing one index in a team or household'],
    notFor: ['Fast-changing projects and ideas', 'Large knowledge bases (only 100 categories)'],
  },
  zettelkasten: {
    origin: 'Niklas Luhmann',
    tagline: 'Small linked notes in your own words; folders only by kind of note.',
    description:
      'Fleeting notes are quick captures, literature notes summarize sources, permanent notes hold one idea each, and hub notes connect them. The links, not the folders, carry the structure.',
    goodFor: ['Research and writing', 'Building ideas over years'],
    notFor: ['Managing projects and tasks', 'Notes you keep as they are without rewriting'],
  },
  topics: {
    origin: null,
    tagline: 'One folder per subject, like shelves in a library.',
    description: 'Each subject gets a folder, with subfolders as subjects grow. Simple to browse; a note has to pick one subject.',
    goodFor: ['Simple, browsable vaults', 'Notes that clearly have one subject'],
    notFor: ['Notes spanning several subjects', "Telling what's active from what's done"],
  },
};
