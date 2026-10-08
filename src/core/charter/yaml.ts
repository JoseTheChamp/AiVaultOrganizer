import { Document, isPair, isScalar, isSeq, LineCounter, type Node, parseDocument, visit } from 'yaml';
import { err, ok, type Result } from '../model/result';
import { stableHash } from '../model/stable-hash';
import { type Charter, type CharterInput, charterSchema } from './schema';

export interface CharterIssue {
  message: string;
  /** Dotted path into the YAML, e.g. `destinations.2.path`; empty for syntax errors. */
  path: string;
  /** 1-based line within the YAML block, when known. */
  line?: number;
}

/**
 * Parses the charter YAML. Never throws: syntax errors and schema violations come back as issues
 * with line numbers, so the code block can show them and the planner can refuse to run (§3.4).
 */
export function parseCharterYaml(text: string): Result<Charter, CharterIssue[]> {
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    return err(
      doc.errors.map((error) => ({
        message: error.message.split('\n')[0] ?? error.message,
        path: '',
        line: lineCounter.linePos(error.pos[0]).line,
      })),
    );
  }
  const parsed = charterSchema.safeParse(doc.toJS());
  if (parsed.success) return ok(parsed.data);
  return err(
    parsed.error.issues.map((issue) => {
      const path = issue.path.map(String);
      return { message: issue.message, path: path.join('.'), line: lineOf(doc, path, lineCounter) };
    }),
  );
}

/** Line of the deepest existing node on the issue's path (missing keys point at their parent). */
function lineOf(doc: Document, path: string[], counter: LineCounter): number | undefined {
  for (let depth = path.length; depth >= 0; depth--) {
    const keys = path.slice(0, depth).map((key) => (/^\d+$/.test(key) ? Number(key) : key));
    const node = depth === 0 ? doc.contents : (doc.getIn(keys, true) as Node | undefined);
    const offset = node?.range?.[0];
    if (offset !== undefined) return counter.linePos(offset).line;
  }
  return undefined;
}

const KEY_ORDER = ['version', 'revision', 'preset', 'language', 'mode', 'inbox', 'destinations', 'system', 'ignore', 'conventions', 'mocs', 'drift', 'jd'];
const DESTINATION_ORDER = ['id', 'path', 'category', 'fallback', 'description', 'layout', 'priority', 'match', 'examples'];

/**
 * Serializes a charter as readable YAML: stable key order, defaults that carry no information left
 * out, rules and short lists in flow style (`match: [{ property: type, equals: project }]`).
 */
export function stringifyCharter(charter: Charter | CharterInput): string {
  const data = charterSchema.parse(charter);
  const plain: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const value = (data as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'destinations') plain[key] = data.destinations.map(compactDestination);
    else if (key === 'ignore' && data.ignore.length === 0) continue;
    else if (key === 'conventions' && Object.keys(data.conventions).length === 0) continue;
    else if (key === 'system' && Object.keys(data.system).length === 0) continue;
    else plain[key] = value;
  }

  const doc = new Document(plain);
  visit(doc, {
    Seq(_key, node, path) {
      const parent = path[path.length - 1];
      if (node.items.every((item) => isScalar(item)) || keyIs(parent, ['match'])) node.flow = true;
    },
    Map(_key, node, path) {
      const parent = path[path.length - 1];
      const grandparent = path[path.length - 2];
      // Rules inside `match: [...]` read best on one line each.
      const isRule = isSeq(parent) && isPair(grandparent) && keyIs(grandparent, ['match']);
      // Small settings objects such as `daily: { path: Daily, filename: YYYY-MM-DD }`.
      const isSmallSetting =
        isPair(parent) &&
        keyIs(parent, ['daily', 'filenames', 'mocs', 'drift', 'links', 'tags', 'properties']) &&
        node.items.every((pair) => isScalar(pair.value) || (isSeq(pair.value) && pair.value.items.every((i) => isScalar(i))));
      if (isRule || isSmallSetting) node.flow = true;
    },
  });
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

function keyIs(pair: unknown, names: string[]): boolean {
  if (!isPair(pair)) return false;
  return isScalar(pair.key) && typeof pair.key.value === 'string' && names.includes(pair.key.value);
}

function compactDestination(destination: Charter['destinations'][number]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of DESTINATION_ORDER) {
    const value = (destination as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'priority' && value === 0) continue;
    if (key === 'fallback' && value !== true) continue;
    if ((key === 'match' || key === 'examples') && Array.isArray(value) && value.length === 0) continue;
    if (key === 'layout' && value === 'flat') continue;
    result[key] = value;
  }
  return result;
}

/** Sets `revision` in existing charter YAML while keeping the user's comments and formatting. */
export function setCharterRevision(text: string, revision: number): string {
  const doc = parseDocument(text);
  doc.set('revision', revision);
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true });
}

/** Identity of the charter's meaning: changes when any rule changes, not when the revision does. */
export function charterFingerprint(charter: Charter): string {
  return stableHash({ ...charter, revision: 0 });
}
