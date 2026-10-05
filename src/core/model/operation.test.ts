import { describe, expect, it } from 'vitest';
import { createOperation, operationId, operationSchema, PHASE, touchedPaths } from './operation';
import { createPlan, parsePlan } from './plan';
import { stableHash, stableStringify } from './stable-hash';

describe('operations', () => {
  it('derives deterministic ids from the intent only', () => {
    const a = createOperation({ kind: 'move', from: 'a.md', to: 'B/a.md' }, { rationale: 'one', confidence: 0.4 });
    const b = createOperation({ kind: 'move', from: 'a.md', to: 'B/a.md' }, { rationale: 'two', confidence: 0.9 });
    const c = createOperation({ kind: 'move', from: 'a.md', to: 'C/a.md' });
    expect(a.id).toBe(b.id);
    expect(a.id).not.toBe(c.id);
    expect(a.id).toMatch(/^move-[0-9a-f]{16}$/);
    expect(operationId({ kind: 'addTags', path: 'x.md', tags: ['a'] })).not.toBe(
      operationId({ kind: 'addTags', path: 'x.md', tags: ['b'] }),
    );
  });

  it('fills metadata defaults', () => {
    const op = createOperation({ kind: 'createFolder', path: 'Projects' });
    expect(op).toMatchObject({ status: 'pending', source: 'user', confidence: 1, rationale: '' });
  });

  it('rejects unknown kinds, a delete operation and invalid values', () => {
    const meta = { id: 'x', rationale: '', confidence: 1, source: 'user', status: 'pending' };
    expect(operationSchema.safeParse({ ...meta, kind: 'delete', path: 'a.md' }).success).toBe(false);
    expect(operationSchema.safeParse({ ...meta, kind: 'move', from: 'a.md', to: '' }).success).toBe(false);
    expect(operationSchema.safeParse({ ...meta, kind: 'addTags', path: 'a.md', tags: [] }).success).toBe(false);
    expect(operationSchema.safeParse({ ...meta, kind: 'move', from: 'a', to: 'b', confidence: 2 }).success).toBe(false);
  });

  it('orders phases folders → moves → properties → links → generated notes', () => {
    expect(PHASE.createFolder).toBeLessThan(PHASE.move);
    expect(PHASE.move).toBeLessThan(PHASE.setProperty);
    expect(PHASE.addTags).toBeLessThan(PHASE.addRelatedLinks);
    expect(PHASE.addRelatedLinks).toBeLessThan(PHASE.createNote);
  });

  it('lists touched paths', () => {
    expect(touchedPaths(createOperation({ kind: 'move', from: 'a.md', to: 'b.md' }))).toEqual(['a.md', 'b.md']);
    expect(
      touchedPaths(createOperation({ kind: 'addRelatedLinks', path: 'a.md', heading: '## Related', targets: ['b.md'] })),
    ).toEqual(['a.md', 'b.md']);
  });
});

describe('plans', () => {
  it('round-trips through JSON', () => {
    const plan = createPlan({
      id: 'plan-1',
      createdAt: '2026-10-05T12:00:00.000Z',
      operations: [createOperation({ kind: 'setProperty', path: 'a.md', key: 'type', value: ['x', 1, null] })],
    });
    const parsed = parsePlan(JSON.parse(JSON.stringify(plan)));
    expect(parsed).toEqual({ ok: true, value: plan });
  });

  it('reports readable errors for invalid plans', () => {
    const parsed = parsePlan({ version: 1, id: 'p', createdAt: 'now', charterRevision: 0, operations: [{ kind: 'move' }] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.some((e) => e.startsWith('operations.0'))).toBe(true);
  });
});

describe('stable hashing', () => {
  it('ignores key order and undefined values', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe('{"a":[1,{"d":2}],"b":1}');
    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));
    expect(stableHash('x')).toMatch(/^[0-9a-f]{28}$/);
  });
});
