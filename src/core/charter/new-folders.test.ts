import { describe, expect, it } from 'vitest';
import { InMemoryVault } from '../testing/in-memory-vault';
import { newFolders } from './new-folders';
import { presetCharter } from './presets/index';

async function found(folders: string[], charter = presetCharter('johnny-decimal', 'en')) {
  return newFolders(await InMemoryVault.from({}, { folders }).snapshot(), charter);
}

describe('newFolders', () => {
  it('finds a category made in a Johnny.Decimal area that the charter does not know', async () => {
    const folders = ['10-19 Life admin/11 Finance', '10-19 Life admin/15 Travel', '10-19 Life admin/15 Travel/Japan', 'Temp', '00-09 System/01 Inbox', '00-09 System/02 Daily'];
    // The new category only: not what is inside it, not top-level leftovers, not the system folders.
    expect(await found(folders)).toEqual(['10-19 Life admin/15 Travel']);
  });

  it('finds a folder made inside a flat destination, but not a new project in an item destination', async () => {
    const para = presetCharter('para', 'en');
    expect(await found(['4 Archive/Old courses', '1 Projects/Website relaunch', '3 Resources/Cooking'], para)).toEqual(['4 Archive/Old courses']);
  });

  it('leaves ignored folders alone', async () => {
    const jd = presetCharter('johnny-decimal', 'en');
    expect(await found(['20-29 Work/24 Private'], { ...jd, ignore: [...jd.ignore, '20-29 Work/24 Private/**'] })).toEqual([]);
  });
});
