import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadFixture } from '../fixture/ground-truth';
import { FIXTURES_DIR } from '../fixture/specs';
import { formatReport, reportName, writeReports } from './report';
import { runEval } from './run-eval';

const result = await runEval(await loadFixture(path.join(FIXTURES_DIR, 'cs-small')), {
  tier: 1,
  record: false,
  embedModel: 'bge-m3',
  chatModel: 'qwen3:8b',
  indexDir: path.join('eval', 'cassettes', 'index', 'cs-small'),
});

describe('formatReport', () => {
  const markdown = formatReport(result);

  it('has a table per area with every method', () => {
    for (const heading of ['## Classification', '## Full plan (PARA)', '## Link suggestions', '## Similarity, duplicates and stubs', '## Clusters', '## Safety', '## Cost per 100 notes']) expect(markdown).toContain(heading);
    for (const method of ['PARA', 'ACE', 'Johnny.Decimal', 'Flat + categories', 'Topic folders']) expect(markdown).toMatch(new RegExp(`^\\| ${method.replace('.', '\\.').replace('+', '\\+')} \\|`, 'm'));
    expect(markdown).toMatch(/^\| words \| /m);
    expect(markdown).toMatch(/^\| embeddings \| /m);
    expect(markdown).toContain('82 notes in Czech. Models: embeddings: bge-m3, language model: none.');
  });

  it('lists notices only when there are some', () => {
    expect(markdown).not.toContain('## Notes');
    expect(formatReport({ ...result, notices: ['Tier 2 has no tasks yet.'] })).toContain('## Notes\n\n- Tier 2 has no tasks yet.');
  });
});

describe('writeReports', () => {
  let dir = '';
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('writes a JSON and a Markdown file per result, named by date, fixture, tier and model', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'avo-reports-'));
    expect(reportName(result, '2026-10-06')).toBe('2026-10-06-cs-small-t1-bge-m3');
    const written = await writeReports([result], dir, '2026-10-06');
    expect(written.map((file) => path.basename(file))).toEqual(['2026-10-06-cs-small-t1-bge-m3.json', '2026-10-06-cs-small-t1-bge-m3.md']);
    expect(JSON.parse(await readFile(written[0] ?? '', 'utf8'))).toEqual(JSON.parse(JSON.stringify(result)));
  });
});
