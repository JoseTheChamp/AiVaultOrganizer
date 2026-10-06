// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ConsentDialog from './ConsentDialog.svelte';
import type { ConsentChoice, ConsentState } from './consent-state';

const state: ConsentState = {
  purpose: 'place the notes that rules and similar notes could not',
  model: 'gpt-x',
  where: 'api.example.com',
  local: false,
  blocked: false,
  notes: 40,
  withheld: 2,
  calls: { min: 5, max: 12 },
  tokens: { min: 24_000, max: 54_000 },
  cost: { min: 0.016, max: 0.036 },
  overBudget: false,
};

describe('ConsentDialog', () => {
  it('says what goes where and what it costs, and returns the answer', async () => {
    const answer = vi.fn<(choice: ConsentChoice) => void>();
    render(ConsentDialog, { state, withoutLabel: 'Plan without it', answer });
    expect(screen.getByText(/These go to api.example.com/)).toBeTruthy();
    expect(screen.getByText(/Notes marked private \(2 here\)/)).toBeTruthy();
    expect(screen.getByText('5–12 requests, about 24,000–54,000 tokens in all.')).toBeTruthy();
    expect(screen.getByText('About 0.016–0.036 at the prices in your settings.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Plan without it' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Use the model' }));
    expect(answer.mock.calls).toEqual([['without'], ['model']]);
  });

  it('cannot use a model that local-only mode blocks', () => {
    render(ConsentDialog, { state: { ...state, blocked: true }, withoutLabel: 'Plan without it', answer: vi.fn() });
    expect(screen.getByRole('alert').textContent).toContain('Local-only mode is on');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use the model' }).disabled).toBe(true);
  });
});
