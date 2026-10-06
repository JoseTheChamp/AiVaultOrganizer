import { describe, expect, it } from 'vitest';
import { clusterLabelV1 } from '../ai/prompts/cluster-label.v1';
import { ScriptedChatProvider } from '../testing/fake-chat';
import { testCard } from '../testing/cards';
import { labelClusters } from './cluster-labels';

const card = (title: string, excerpt: string) => testCard(`${title}.md`, excerpt);

describe('cluster-label v1', () => {
  const input = {
    language: 'cs' as const,
    groups: [
      { id: 'g1', keywords: ['rajčata', 'kompost'], samples: [card('Sazenice', 'Sazenice potřebují světlo.')] },
      { id: 'g2', keywords: ['intervaly'], samples: [card('Trénink', 'Intervaly v úterý.')] },
    ],
  };

  it('renders a stable prompt in the vault language', () => {
    expect(clusterLabelV1.build(input)).toMatchSnapshot();
  });

  it('accepts only the shown groups, each exactly once', () => {
    const schema = clusterLabelV1.schema(input);
    const label = (groupId: string) => ({ groupId, label: 'Zahrada', description: 'Poznámky o zahradě.' });
    expect(schema.safeParse({ labels: [label('g1'), label('g2')] }).success).toBe(true);
    expect(schema.safeParse({ labels: [label('g1')] }).success).toBe(false);
    expect(schema.safeParse({ labels: [label('g1'), label('g1'), label('g2')] }).success).toBe(false);
    expect(schema.safeParse({ labels: [label('g1'), label('g9')] }).success).toBe(false);
  });
});

describe('labelClusters', () => {
  const requests = [
    { id: 0, keywords: ['tomatoes', 'compost', 'bed'], samples: [card('Seedlings', 'Need light.')] },
    { id: 1, keywords: ['intervals', 'long', 'run'], samples: [card('Training', 'Four runs a week.')] },
    { id: 2, keywords: ['budget', 'savings'], samples: [card('Budget', 'Needs and wants.')] },
  ];

  it('labels clusters in batches and maps answers back by group', async () => {
    const provider = new ScriptedChatProvider([
      JSON.stringify({ labels: [{ groupId: 'g2', label: 'Running', description: 'Training for a race.' }, { groupId: 'g1', label: 'Gardening', description: 'Growing vegetables.' }] }),
      JSON.stringify({ labels: [{ groupId: 'g1', label: 'Money', description: 'Budget and savings.' }] }),
    ]);
    const report = await labelClusters(provider, 'en', requests, 2);
    expect(report.labels).toEqual([
      { id: 0, label: 'Gardening', description: 'Growing vegetables.', source: 'model' },
      { id: 1, label: 'Running', description: 'Training for a race.', source: 'model' },
      { id: 2, label: 'Money', description: 'Budget and savings.', source: 'model' },
    ]);
    expect(report).toMatchObject({ calls: 2, failures: 0, repaired: 0 });
    expect(provider.requests[0]?.prompt).toEqual({ id: 'cluster-label', version: 1 });
    expect(provider.requests[0]?.temperature).toBe(0);
  });

  it('repairs once, then falls back to keywords and counts the failure', async () => {
    const provider = new ScriptedChatProvider([
      'not json',
      JSON.stringify({ labels: [{ groupId: 'g1', label: 'Gardening', description: 'Vegetables.' }] }),
      'still not json',
      'nope',
    ]);
    const report = await labelClusters(provider, 'en', requests.slice(0, 2), 1);
    expect(report.labels).toEqual([
      { id: 0, label: 'Gardening', description: 'Vegetables.', source: 'model' },
      { id: 1, label: 'intervals, long, run', description: '', source: 'keywords' },
    ]);
    expect(report).toMatchObject({ calls: 4, failures: 1, repaired: 1 });
  });
});
