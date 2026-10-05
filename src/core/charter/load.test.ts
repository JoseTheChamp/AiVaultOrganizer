import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '../hash';
import { InMemoryVault } from '../testing/in-memory-vault';
import { renderCharterNote } from './charter-note';
import { loadCharter } from './load';
import { presetCharter } from './presets/index';

describe('loadCharter', () => {
  it('distinguishes missing, block-less, invalid and valid charters', async () => {
    const vault = InMemoryVault.from({
      'Ok.md': renderCharterNote(presetCharter('para', 'en')),
      'Plain.md': '# Just a note',
      'Broken.md': '```charter\nversion: 1\npreset: nope\n```\n',
    });
    expect(await loadCharter(vault, webCryptoHasher, 'Missing.md')).toEqual({ status: 'missing', path: 'Missing.md' });
    expect((await loadCharter(vault, webCryptoHasher, 'Plain.md')).status).toBe('no-block');
    const broken = await loadCharter(vault, webCryptoHasher, 'Broken.md');
    expect(broken.status === 'invalid' && broken.issues.map((i) => i.path)).toEqual(['preset', 'destinations']);
    const ok = await loadCharter(vault, webCryptoHasher, 'Ok.md');
    expect(ok.status === 'ok' && ok.charter.preset).toBe('para');
    expect(ok.status === 'ok' && ok.note.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
