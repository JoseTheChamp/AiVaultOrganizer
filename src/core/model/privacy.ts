/**
 * Frontmatter property that keeps a note away from every AI feature (PLAN §7.11):
 * `ai-vault-organizer: private`. Such notes are never sent to a model, but rules can still move them
 * and local word statistics still see them, since nothing leaves the device for those.
 */
export const PRIVATE_PROPERTY = 'ai-vault-organizer';

export function isPrivateNote(frontmatter: Readonly<Record<string, unknown>>): boolean {
  const value = frontmatter[PRIVATE_PROPERTY];
  const values = Array.isArray(value) ? (value as unknown[]) : [value];
  return values.some((item) => typeof item === 'string' && item.trim().toLowerCase() === 'private');
}
