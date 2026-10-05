/** `count` followed by the singular or plural form: `plural(1, 'note')` → `1 note`. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Picks the verb form matching a count: `verb(1, 'has', 'have')` → `has`. */
export function verb(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
