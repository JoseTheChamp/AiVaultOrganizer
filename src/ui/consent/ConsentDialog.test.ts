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
  unavailable: null,
  notes: 40,
  withheld: 2,
  calls: { min: 5, max: 12 },
  tokens: { min: 24_000, max: 54_000 },
  cost: { min: 0.016, max: 0.036 },
  overBudget: false,
  duration: null,
};

describe('ConsentDialog', () => {
  it('says what goes where and what it costs, and returns the answer', async () => {
    const answer = vi.fn<(choice: ConsentChoice) => void>();
    render(ConsentDialog, { state, withoutLabel: 'Without AI', answer });
    expect(screen.getByText(/via api.example.com would place the notes/)).toBeTruthy();
    expect(screen.getByText(/About 5–12 requests and 24,000–54,000 tokens, about 0.016–0.036 at your prices/)).toBeTruthy();
    expect(screen.getByText(/It goes to api.example.com/)).toBeTruthy();
    expect(screen.getByText(/Private notes \(2 here\)/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Without AI' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Use AI' }));
    expect(answer.mock.calls).toEqual([['without'], ['model']]);
  });

  it('says how long a run may take once the model has been timed', () => {
    render(ConsentDialog, { state: { ...state, duration: { min: 240_000, max: 480_000 } }, withoutLabel: 'Without AI', answer: vi.fn() });
    expect(screen.getByText(/At the pace of the last run, this takes 4–8 min./)).toBeTruthy();
  });

  it('cannot use a model that is blocked or offline, and says why', () => {
    render(ConsentDialog, { state: { ...state, unavailable: 'The model does not answer. Start its app.' }, withoutLabel: 'Without AI', answer: vi.fn() });
    expect(screen.getByRole('alert').textContent).toBe('The model does not answer. Start its app.');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Use AI' }).disabled).toBe(true);
  });
});
