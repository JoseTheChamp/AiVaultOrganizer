/**
 * Tiny synthetic vaults, one per organization method, for unit tests of analysis and planning.
 * All content is invented (invariant 7: no real personal notes in the repo).
 */

type Files = Record<string, string>;

const note = (title: string, body = '', frontmatter = ''): string =>
  `${frontmatter ? `---\n${frontmatter}\n---\n` : ''}# ${title}\n\n${body}\n`;

export function tinyParaVault(): { files: Files; folders: string[] } {
  return {
    files: {
      '0 Inbox/Quick idea.md': note('Quick idea', 'Try a standing desk. #idea'),
      '0 Inbox/Call notes.md': note('Call notes', 'Talked about the [[Website relaunch]].'),
      '1 Projects/Website relaunch/Website relaunch.md': note(
        'Website relaunch',
        'Goal: ship the new site. See [[Design brief]] and [[Hosting]].',
        'type: project\nstatus: active',
      ),
      '1 Projects/Website relaunch/Design brief.md': note('Design brief', 'Colors and fonts. #design'),
      '2 Areas/Health/Sleep.md': note('Sleep', 'Aim for eight hours. Related: [[Running]].', 'type: area'),
      '2 Areas/Health/Running.md': note('Running', 'Weekly plan. #health'),
      '2 Areas/Finance/Budget.md': note('Budget', 'Monthly budget review.', 'type: area'),
      '3 Resources/Cooking/Pasta.md': note('Pasta', 'Boil water, add salt. #recipe'),
      '3 Resources/Programming/Hosting.md': note('Hosting', 'Static hosting options.', 'type: resource'),
      '4 Archive/Old project.md': note('Old project', 'Finished last year.', 'status: done'),
      'Templates/Project.md': note('{{title}}', '', 'type: project'),
      'Daily/2026-09-30.md': note('2026-09-30', 'Worked on the [[Website relaunch]].'),
      'Loose note.md': note('Loose note', 'Unfiled thought.'),
      'Attachments/diagram.png': 'binary',
    },
    folders: ['3 Resources/Empty topic'],
  };
}

export function tinyJohnnyDecimalVault(): { files: Files; folders: string[] } {
  return {
    files: {
      '00-09 System/00 Index/00.00 Index.md': note('00.00 Index', 'Areas and categories.'),
      '10-19 Finance/11 Banking/11.01 Statements.md': note('11.01 Statements', 'Monthly statements.'),
      '10-19 Finance/11 Banking/11.02 Accounts.md': note('11.02 Accounts', 'Account list.'),
      '10-19 Finance/12 Taxes/12.01 Tax return 2025.md': note('12.01 Tax return 2025', 'Filed in April.'),
      '20-29 Home/21 Maintenance/21.01 Boiler.md': note('21.01 Boiler', 'Service every year.'),
      '20-29 Home/22 Garden/22.01 Planting plan.md': note('22.01 Planting plan', 'Tomatoes in May.'),
      'Unsorted note.md': note('Unsorted note', 'Should get an ID.'),
    },
    folders: [],
  };
}

export function tinyAceVault(): { files: Files; folders: string[] } {
  return {
    files: {
      'Atlas/Maps/Learning MOC.md': note('Learning MOC', '[[Spaced repetition]] [[Feynman technique]]'),
      'Atlas/Notes/Spaced repetition.md': note('Spaced repetition', 'Review at growing intervals.'),
      'Atlas/Notes/Feynman technique.md': note('Feynman technique', 'Explain it simply.'),
      'Atlas/Sources/How to take smart notes.md': note('How to take smart notes', 'Book notes.'),
      'Calendar/Daily/2026-10-01.md': note('2026-10-01', 'Reviewed [[Learning MOC]].'),
      'Calendar/Meetings/2026-10-02 Team sync.md': note('2026-10-02 Team sync', 'Agenda.'),
      'Efforts/On/Write course.md': note('Write course', 'Outline modules.'),
      'Efforts/Simmering/Learn piano.md': note('Learn piano', 'Someday.'),
    },
    folders: ['Efforts/Sleeping'],
  };
}

export function tinyZettelkastenVault(): { files: Files; folders: string[] } {
  return {
    files: {
      '202601011200 Atomic notes.md': note('Atomic notes', 'One idea per note. See [[202601011230 Linking]].'),
      '202601011230 Linking.md': note('Linking', 'Links create context. [[202601011200 Atomic notes]] [[202601021000 Hubs]]'),
      '202601021000 Hubs.md': note('Hubs', 'Structure notes. [[202601011200 Atomic notes]] [[202601011230 Linking]]'),
      '202601031415 Fleeting capture.md': note('Fleeting capture', 'Write it down fast. [[202601021000 Hubs]]'),
      '202601041600 Literature review.md': note('Literature review', 'Summaries in own words. [[202601011230 Linking]]'),
      'Sources/Ahrens 2017.md': note('Ahrens 2017', 'Book. [[202601041600 Literature review]]'),
    },
    folders: [],
  };
}

export function tinyFlatVault(): { files: Files; folders: string[] } {
  return {
    files: {
      'Books.md': note('Books', '```base\nfilters:\n  and:\n    - categories.contains(link("Books"))\n```'),
      'Thinking fast and slow.md': note('Thinking fast and slow', 'Two systems.', 'categories: ["[[Books]]"]'),
      'Deep work.md': note('Deep work', 'Focus.', 'categories: ["[[Books]]"]'),
      'Morning routine.md': note('Morning routine', 'Coffee first.', 'categories: ["[[Habits]]"]'),
      'Habits.md': note('Habits', '', 'categories: []'),
      'Trip to Prague.md': note('Trip to Prague', 'Itinerary.', 'categories: ["[[Trips]]"]'),
      'References/Daniel Kahneman.md': note('Daniel Kahneman', 'Author.', 'categories: ["[[People]]"]'),
      'Clippings/Article on focus.md': note('Article on focus', 'Clipped.', 'source: https://example.com/focus'),
      'Daily/2026-10-03.md': note('2026-10-03', 'Read [[Deep work]].'),
      'Templates/Book.md': note('{{title}}', '', 'categories: ["[[Books]]"]'),
      'Books.base': 'filters: {}',
    },
    folders: ['Attachments'],
  };
}

export function tinyTopicVault(): { files: Files; folders: string[] } {
  return {
    files: {
      'Programming/TypeScript/Generics.md': note('Generics', 'Type parameters.'),
      'Programming/TypeScript/Narrowing.md': note('Narrowing', 'typeof checks.'),
      'Programming/Rust/Ownership.md': note('Ownership', 'Borrow checker.'),
      'Cooking/Bread.md': note('Bread', 'Sourdough starter.'),
      'Cooking/Soups/Goulash.md': note('Goulash', 'Paprika!'),
      'Travel/Japan.md': note('Japan', 'Kyoto temples.'),
      'Travel/Iceland.md': note('Iceland', 'Ring road.'),
      'Health/Stretching.md': note('Stretching', 'Every morning.'),
      'Notes/Misc.md': note('Misc', 'Random.'),
      'Notes/Untitled.md': '',
    },
    folders: ['Music'],
  };
}

/** Czech PARA vault: localized folder names and diacritics in titles and tags. */
export function tinyCzechParaVault(): { files: Files; folders: string[] } {
  return {
    files: {
      '0 Inbox/Nápad.md': note('Nápad', 'Koupit nové kolo. #nápad'),
      '1 Projekty/Rekonstrukce koupelny/Rozpočet.md': note('Rozpočet', 'Obklady a dlažba.', 'type: project'),
      '2 Oblasti/Zdraví/Spánek.md': note('Spánek', 'Chodit spát před jedenáctou. #zdraví'),
      '3 Zdroje/Vaření/Svíčková.md': note('Svíčková', 'Recept od babičky. #recept'),
      '4 Archiv/Stará dovolená.md': note('Stará dovolená', 'Chorvatsko.', 'status: done'),
      'Šablony/Projekt.md': note('{{title}}', '', 'type: project'),
    },
    folders: [],
  };
}
