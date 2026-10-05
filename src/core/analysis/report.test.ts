import { describe, expect, it } from 'vitest';
import { tinyParaVault } from '../testing/fixtures';
import { InMemoryVault } from '../testing/in-memory-vault';
import { analyzeVault } from './analyze';
import { formatAnalysisMarkdown } from './report';

describe('formatAnalysisMarkdown', () => {
  it('renders score, method, overview, methods and applicable health rows', async () => {
    const { files, folders } = tinyParaVault();
    const snapshot = await InMemoryVault.from(files, { folders }).snapshot();
    const markdown = formatAnalysisMarkdown(analyzeVault(snapshot, { now: 0 }));

    expect(markdown).toMatch(/^# Vault diagnostics\n/);
    expect(markdown).toContain('**Method:** Mostly PARA.');
    expect(markdown).toContain('| Notes | 13 |');
    expect(markdown).toContain('| PARA | 100 % |');
    expect(markdown).toContain('| Linked notes |');
    expect(markdown).not.toContain('Pasta'); // no note titles or contents
  });
});
