import { describe, expect, it } from 'vitest';
import { planSummaryV1 } from '../ai/prompts/plan-summary.v1';
import { presetCharter } from '../charter/presets';
import { createOperation } from '../model/operation';
import { createPlan } from '../model/plan';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { describePlan, planFacts, summarizePlan } from './summary';

const charter = presetCharter('para', 'cs');
const plan = createPlan({
  id: 'p',
  createdAt: '2026-10-07T00:00:00.000Z',
  operations: [
    createOperation({ kind: 'createFolder', path: '1 Projekty/Diplomová práce' }, { source: 'rule' }),
    createOperation({ kind: 'move', from: 'Koncept.md', to: '1 Projekty/Diplomová práce/Koncept.md' }, { source: 'knn', confidence: 0.9 }),
    createOperation({ kind: 'move', from: 'Kvásek.md', to: '3 Zdroje/Vaření/Kvásek.md' }, { source: 'llm', confidence: 0.6, rationale: 'Recept.' }),
    createOperation({ kind: 'flag', path: 'Nevím.md', issue: 'ambiguous' }, { confidence: 0 }),
    createOperation({ kind: 'flag', path: 'Dashboard.md', issue: 'query-breakage', related: ['1 Projekty'] }),
  ],
  warnings: [{ code: 'ambiguous', message: '1 note could not be placed.', opIds: [] }],
});

describe('planFacts', () => {
  it('counts operations, notes per destination, and leads with what needs review', () => {
    const facts = planFacts(plan, charter);
    expect(facts).toMatchObject({ language: 'cs', method: 'PARA', destinations: ['1 Projekty: 1', '3 Zdroje: 1'], warnings: ['1 note could not be placed.'] });
    expect(facts.counts).toEqual(['new folders: 1', 'moves: 2', 'flags for you to look at: 2']);
    expect(facts.examples.slice(0, 3)).toEqual([
      'Flag "Nevím.md" as ambiguous',
      'Flag "Dashboard.md" as query breakage',
      'Move "Kvásek.md" to "3 Zdroje/Vaření/Kvásek.md"',
    ]);
  });
});

describe('describePlan', () => {
  it('summarizes from the numbers without a model', () => {
    expect(describePlan(plan, charter)).toEqual({
      summary: 'This plan moves 2 notes into the structure of your charter (PARA). It also makes 1 other change. 2 notes need your decision.',
      highlights: ['1 change is less certain; check it first.', '1 note could not be placed.', '1 query will show different notes.'],
      source: 'rules',
    });
  });
});

describe('summarizePlan', () => {
  it('uses the model when there is one, and the numbers when it fails', async () => {
    const reply = JSON.stringify({ summary: 'Plán přesune dvě poznámky.', highlights: ['Zkontrolujte recept.'] });
    expect(await summarizePlan(plan, charter, new ScriptedChatProvider([reply]))).toEqual({ summary: 'Plán přesune dvě poznámky.', highlights: ['Zkontrolujte recept.'], source: 'model' });
    expect((await summarizePlan(plan, charter, new ScriptedChatProvider(['?', '?']))).source).toBe('rules');
    expect((await summarizePlan(plan, charter)).source).toBe('rules');
  });

  it('renders a stable prompt with no note contents', () => {
    const messages = planSummaryV1.build(planFacts(plan, charter));
    expect(messages).toMatchSnapshot();
    expect(JSON.stringify(messages)).not.toContain('Recept.');
  });
});
