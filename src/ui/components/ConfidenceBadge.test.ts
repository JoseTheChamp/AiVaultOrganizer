// @vitest-environment jsdom
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import ConfidenceBadge from './ConfidenceBadge.svelte';

describe('ConfidenceBadge', () => {
  it('shows the confidence as a percentage, banded for the review', () => {
    render(ConfidenceBadge, { confidence: 0.874, source: 'llm' });
    const badge = screen.getByText('87 %');
    expect(badge.classList).toContain('avo-badge-high');
    expect(badge.getAttribute('aria-label')).toBe('Confidence 87 %, decided by llm');
  });

  it('marks uncertain decisions', () => {
    render(ConfidenceBadge, { confidence: 0.39 });
    expect(screen.getByText('39 %').classList).toContain('avo-badge-low');
  });
});
