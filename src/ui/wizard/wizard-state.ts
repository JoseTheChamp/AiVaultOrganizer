import type { VaultAnalysis } from '../../core/analysis/analyze';
import type { CharterChanges } from '../../core/charter/customize';
import { withFallback } from '../../core/charter/fallback';
import { adaptPresetToVault, inferCharter } from '../../core/charter/infer';
import { METHOD_ABOUT, type MethodAbout } from '../../core/charter/presets/about';
import { type Lang, PRESET_ORDER, presetCharter } from '../../core/charter/presets/index';
import type { Charter } from '../../core/charter/schema';
import { METHOD_LABELS, type MethodId } from '../../core/model/methods';
import type { VaultSnapshot } from '../../core/model/note';
import { fileName, parentFolder } from '../../core/model/paths';

/** The wizard's steps before the charter is written (PLAN §2.1, steps 1–4). */
export const STEPS = [
  { id: 'choose', label: 'Choose a system' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'create', label: 'Create' },
] as const;
export type WizardStep = (typeof STEPS)[number]['id'];

/** The charter there is (to edit it), the AI's draft, a known method, or the vault's own folders. */
export type Choice = 'existing' | 'draft' | MethodId | 'codify';

export interface WizardInput {
  snapshot: VaultSnapshot;
  analysis: VaultAnalysis;
  existing: Charter | null;
  /** The existing charter's rules are invalid and will be replaced. */
  replacesInvalid: boolean;
  charterPath: string;
  /**
   * Folders the user made in the vault that the charter does not know yet ("Scan and organize"): the
   * wizard opens at Adjust, on the current charter, with them added.
   */
  found?: readonly string[];
}

export interface ChoiceOption {
  choice: Choice;
  label: string;
  /** What it is and what it suits, for the "About" expander. */
  about: MethodAbout;
  recommended: boolean;
  /** How well the vault already matches (0..1); null for "keep my structure". */
  fit: number | null;
}

const CODIFY_ABOUT: MethodAbout = {
  origin: null,
  tagline: 'Turn the folders you already have into a charter. Nothing has to move.',
  description: 'The charter describes your current folders, so new notes can follow the same system and drift is noticed. It changes nothing about how the vault is organized today.',
  goodFor: ['A vault already organized your way', 'Keeping new notes consistent'],
  notFor: ['A vault that is a mess today: it keeps the mess'],
};

const EXISTING_ABOUT: MethodAbout = {
  origin: null,
  tagline: 'Keep the charter you have and adjust it.',
  description: 'Rename folders, leave some out, or change conventions. Earlier changes to the charter stay.',
  goodFor: ['Small changes to a system that works'],
  notFor: [],
};

/** Editing keeps the charter there is; otherwise a detected method, or the vault's own structure. */
export function recommendedChoice(input: Pick<WizardInput, 'analysis' | 'existing'>): Choice {
  if (input.existing) return 'existing';
  const dominant = input.analysis.methods.dominant;
  return dominant === 'none' || dominant === 'mixed' || dominant === 'topics' ? 'codify' : dominant;
}

export function choiceOptions(input: Pick<WizardInput, 'analysis' | 'existing'>, draft: Charter | null = null): ChoiceOption[] {
  const recommended = recommendedChoice(input);
  const fit = new Map(input.analysis.methods.scores.map((score) => [score.method, score.score]));
  const existing: ChoiceOption[] = input.existing ? [{ choice: 'existing', label: 'Keep my charter', about: EXISTING_ABOUT, recommended: !draft, fit: null }] : [];
  const codify: ChoiceOption = { choice: 'codify', label: 'Keep my current structure', about: CODIFY_ABOUT, recommended: !draft && recommended === 'codify', fit: null };
  const drafted: ChoiceOption[] = draft ? [{ choice: 'draft', label: 'Suggested by AI', about: draftAbout(draft), recommended: true, fit: null }] : [];
  return [
    ...drafted,
    ...existing,
    codify,
    ...PRESET_ORDER.map((method) => ({
      choice: method,
      label: METHOD_LABELS[method],
      about: METHOD_ABOUT[method],
      recommended: !draft && recommended === method,
      fit: fit.get(method) ?? 0,
    })),
  ];
}

/**
 * The charter a choice starts from, fitted to the vault (existing folder names are reused), with an
 * Other folder for notes nothing else fits (ADR 0010); the user can remove it.
 */
export function baseCharter(input: WizardInput, choice: Choice, lang: Lang, draft: Charter | null = null): Charter {
  return withFallback(startingCharter(input, choice, lang, draft));
}

function startingCharter(input: WizardInput, choice: Choice, lang: Lang, draft: Charter | null): Charter {
  if (choice === 'draft' && draft) return draft;
  if (choice === 'existing' && input.existing) return input.existing;
  // Without the charter or draft they refer to, these fall back to the vault's own structure.
  if (choice === 'codify' || choice === 'existing' || choice === 'draft') return inferCharter(input.snapshot, input.analysis, lang);
  return adaptPresetToVault(presetCharter(choice, lang), input.snapshot);
}

/** What the model proposed, in the words of the method it is based on. */
function draftAbout(draft: Charter): MethodAbout {
  const based = draft.preset === 'custom' ? null : METHOD_ABOUT[draft.preset];
  return {
    origin: null,
    tagline: `${draft.preset === 'custom' ? 'A system of its own' : `Based on ${METHOD_LABELS[draft.preset]}`}, fitted to your notes by the language model.`,
    description: based?.description ?? 'The model proposed these folders after reading samples of your notes. Adjust them in the next step.',
    goodFor: based?.goodFor ?? [],
    notFor: based?.notFor ?? [],
  };
}

/** A folder added in the Adjust step; the key keeps its row in place while others come and go. */
export interface AddedFolder {
  key: number;
  /**
   * What it is inside: '' (the top level), 'd:<id>' (a charter folder), 'a:<key>' (another new folder)
   * or 'g:<path>' (a folder that only groups others, such as a Johnny.Decimal area). Renaming the
   * parent carries the folder along.
   */
  parent: string;
  /** Its own name. At the top level it may hold a path ("40-49 Hobbies/41 Sport"). */
  name: string;
  description: string;
}

/** The Customize step's form: every change the wizard offers, always filled in. */
export interface WizardChanges extends Required<Omit<CharterChanges, 'added' | 'order'>> {
  paths: Record<string, string>;
  removed: string[];
  added: AddedFolder[];
  /** Rows in the order the user dragged them into ('d:<id>', 'a:<key>', 'g:<path>'); empty keeps the charter's. */
  order: string[];
  ignore: string[];
}

/** The form's starting values: what the base charter already says. */
export function initialChanges(charter: Charter): WizardChanges {
  return {
    paths: Object.fromEntries(charter.destinations.filter((d) => d.path !== undefined).map((d) => [d.id, d.path as string])),
    removed: [],
    added: [],
    order: [],
    inbox: charter.inbox ?? '',
    tagStyle: charter.conventions.tags?.style ?? 'keep',
    relatedHeading: charter.conventions.links?.relatedHeading ?? '## Related',
    mocs: charter.mocs?.enabled ?? false,
    ignore: [...charter.ignore],
  };
}

/** A folder found in the vault, ready to join the charter: inside its parent, described from its name. */
export function foundFolder(path: string, key: number, charter: Charter): AddedFolder {
  const parent = parentFolder(path);
  const holder = charter.destinations.find((d) => d.path?.toLowerCase() === parent.toLowerCase());
  const name = fileName(path);
  // "15 Travel" in Johnny.Decimal is about travel.
  const subject = name.replace(/^\d{2}\s+/, '');
  return { key, parent: parent === '' ? '' : holder ? `d:${holder.id}` : `g:${parent}`, name, description: `Notes about ${subject}.` };
}

/**
 * An example name for a new top-level folder, in the charter's own naming: in Johnny.Decimal a new
 * area with its first category ("40-49 Hobbies/41 Sport"), elsewhere a plain name.
 */
export function newFolderExample(charter: Charter): string {
  if (!charter.jd) return 'e.g. Hobbies';
  const used = new Set(charter.jd.areas.map((area) => area.id.slice(0, 2)));
  const free = ['10', '20', '30', '40', '50', '60', '70', '80'].find((low) => !used.has(low)) ?? '80';
  const area = `${free}-${String(Number(free) + 9)}`;
  return `e.g. ${area} Hobbies/${String(Number(free) + 1)} Sport`;
}
