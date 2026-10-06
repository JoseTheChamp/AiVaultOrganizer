import type { VaultAnalysis } from '../../core/analysis/analyze';
import type { CharterChanges } from '../../core/charter/customize';
import { adaptPresetToVault, inferCharter } from '../../core/charter/infer';
import { type Lang, PRESET_ORDER, PRESETS, presetCharter } from '../../core/charter/presets/index';
import type { Charter } from '../../core/charter/schema';
import { computeDrift } from '../../core/drift/drift';
import { METHOD_LABELS, type MethodId } from '../../core/model/methods';
import type { VaultSnapshot } from '../../core/model/note';

/** The wizard's steps before the charter is written (PLAN §2.1, steps 1–4). */
export const STEPS = [
  { id: 'diagnose', label: 'Diagnose' },
  { id: 'method', label: 'Method' },
  { id: 'customize', label: 'Customize' },
  { id: 'charter', label: 'Charter' },
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
}

export interface ChoiceOption {
  choice: Choice;
  label: string;
  /** One paragraph, plain text, in the chosen language. */
  summary: string;
  recommended: boolean;
  /** How well the vault already matches (0..1); null for "keep my structure". */
  fit: number | null;
}

/** Editing keeps the charter there is; otherwise a detected method, or the vault's own structure. */
export function recommendedChoice(input: Pick<WizardInput, 'analysis' | 'existing'>): Choice {
  if (input.existing) return 'existing';
  const dominant = input.analysis.methods.dominant;
  return dominant === 'none' || dominant === 'mixed' || dominant === 'topics' ? 'codify' : dominant;
}

export function choiceOptions(input: Pick<WizardInput, 'analysis' | 'existing'>, lang: Lang, draft: Charter | null = null): ChoiceOption[] {
  const recommended = recommendedChoice(input);
  const fit = new Map(input.analysis.methods.scores.map((score) => [score.method, score.score]));
  const existing: ChoiceOption[] = input.existing
    ? [{ choice: 'existing', label: 'Keep my charter', summary: 'Edit the charter you have: folder names, conventions and ignored notes.', recommended: !draft, fit: null }]
    : [];
  const codify: ChoiceOption = {
    choice: 'codify',
    label: 'Keep my current structure',
    summary: 'Describes the folders you already have as a charter, so new notes follow the same system. Nothing has to move.',
    recommended: !draft && recommended === 'codify',
    fit: null,
  };
  const drafted: ChoiceOption[] = draft ? [{ choice: 'draft', label: 'AI draft', summary: describeDraft(draft), recommended: true, fit: null }] : [];
  return [
    ...drafted,
    ...existing,
    codify,
    ...PRESET_ORDER.map((method) => ({
      choice: method,
      label: METHOD_LABELS[method],
      // Summaries carry Markdown emphasis for the charter note; the wizard shows plain text.
      summary: PRESETS[method].summary[lang].replace(/\*\*/g, ''),
      recommended: !draft && recommended === method,
      fit: fit.get(method) ?? 0,
    })),
  ];
}

/** The charter a choice starts from, fitted to the vault (existing folder names are reused). */
export function baseCharter(input: WizardInput, choice: Choice, lang: Lang, draft: Charter | null = null): Charter {
  if (choice === 'draft' && draft) return draft;
  if (choice === 'existing' && input.existing) return input.existing;
  // Without the charter or draft they refer to, these fall back to the vault's own structure.
  if (choice === 'codify' || choice === 'existing' || choice === 'draft') return inferCharter(input.snapshot, input.analysis, lang);
  return adaptPresetToVault(presetCharter(choice, lang), input.snapshot);
}

/** One line about a draft: its method and destinations. */
function describeDraft(draft: Charter): string {
  const method = draft.preset === 'custom' ? 'A charter of its own' : `Based on ${METHOD_LABELS[draft.preset]}`;
  return `${method}, with ${draft.destinations.map((d) => d.path ?? d.category ?? d.id).join(', ')}. Review and adjust it in the next step.`;
}

/** The Customize step's form: every change the wizard offers, always filled in. */
export interface WizardChanges extends Required<CharterChanges> {
  paths: Record<string, string>;
  removed: string[];
  ignore: string[];
}

/** The form's starting values: what the base charter already says. */
export function initialChanges(charter: Charter): WizardChanges {
  return {
    paths: Object.fromEntries(charter.destinations.filter((d) => d.path !== undefined).map((d) => [d.id, d.path as string])),
    removed: [],
    inbox: charter.inbox ?? '',
    tagStyle: charter.conventions.tags?.style ?? 'keep',
    relatedHeading: charter.conventions.links?.relatedHeading ?? '## Related',
    mocs: charter.mocs?.enabled ?? false,
    ignore: [...charter.ignore],
  };
}

export interface CharterPreview {
  /** Notes already where the charter puts them. */
  fit: number;
  /** Notes its rules would move or re-categorize. */
  ruleMoves: number;
  /** Notes no rule places: for similar notes, the model, or the user. */
  open: number;
}

/** What a charter would mean for the vault, from its rules alone (cheap enough to run on every edit). */
export function previewCharter(input: WizardInput, charter: Charter): CharterPreview {
  const drift = computeDrift(input.snapshot, charter, { charterPath: input.charterPath, now: Date.now() });
  return {
    fit: drift.noteCount - drift.offCharter,
    ruleMoves: drift.counts.misplaced + drift.counts['missing-category'],
    open: drift.counts.unplaced,
  };
}
