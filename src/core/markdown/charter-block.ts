import { err, ok, type Result } from '../model/result';

const BLOCK = /^```charter[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/m;

export interface CharterBlock {
  yaml: string;
  /** Offsets of the YAML between the fences. */
  start: number;
  end: number;
}

/** Finds the first ```charter fenced block of a note. */
export function findCharterBlock(content: string): CharterBlock | null {
  const match = BLOCK.exec(content);
  if (!match || match[1] === undefined) return null;
  const start = match.index + match[0].indexOf(match[1]);
  return { yaml: match[1], start, end: start + match[1].length };
}

/** Replaces the YAML inside the ```charter block, leaving everything else untouched. */
export function replaceCharterBlock(content: string, yaml: string): Result<string, 'missing'> {
  const block = findCharterBlock(content);
  if (!block) return err('missing');
  const body = yaml.endsWith('\n') ? yaml : `${yaml}\n`;
  return ok(content.slice(0, block.start) + body + content.slice(block.end));
}
