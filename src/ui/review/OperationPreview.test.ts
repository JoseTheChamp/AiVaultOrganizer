// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import OperationPreview from './OperationPreview.svelte';

describe('OperationPreview', () => {
  it('says in words which lines are added and removed, not only with signs and colours', () => {
    render(OperationPreview, {
      preview: {
        kind: 'edit',
        path: 'Plan.md',
        lines: [
          { type: 'same', text: '---' },
          { type: 'remove', text: 'Type: note' },
          { type: 'add', text: 'type: note' },
          { type: 'gap', count: 3 },
        ],
      },
      openNote: vi.fn(),
    });
    const changes = screen.getByRole('group', { name: 'Changes to Plan.md' });
    expect(changes.textContent).toMatch(/Removed:\s*Type: note/);
    expect(changes.textContent).toMatch(/Added:\s*type: note/);
    expect(changes.textContent).toContain('… 3 unchanged lines');
  });
});
