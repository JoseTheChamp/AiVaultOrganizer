import * as z from 'zod';
import { METHOD_IDS } from '../model/methods';
import { normalizeVaultPath } from '../model/paths';

/**
 * The machine-readable part of the charter: the ```charter YAML block (PLAN §3.2). The YAML block is
 * authoritative; the prose sections of the charter note are generated from it.
 */

export const PRESET_IDS = [...METHOD_IDS, 'custom'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const CHARTER_MODES = ['folders', 'properties', 'hybrid'] as const;
export const LAYOUTS = ['flat', 'subfolder-per-item', 'subfolder-per-topic'] as const;

const folder = z
  .string()
  .min(1)
  .refine((path) => normalizeVaultPath(path) === path, 'must be a vault path without leading/trailing slashes')
  .refine((path) => !path.split('/').some((segment) => segment.startsWith('.')), 'must not be a hidden folder');

const scalar = z.union([z.string(), z.number(), z.boolean()]);

const validRegex = (source: string) => {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
};

/** A deterministic rule. A destination matches a note when any of its rules matches. */
export const ruleSchema = z.union([
  z.object({ property: z.string().min(1), equals: z.union([scalar, z.array(scalar).min(1)]) }).strict(),
  z.object({ property: z.string().min(1), exists: z.boolean() }).strict(),
  z.object({ tag: z.string().min(1) }).strict(),
  z.object({ filename: z.string().min(1).refine(validRegex, 'must be a valid regular expression') }).strict(),
  z.object({ pathGlob: z.string().min(1) }).strict(),
]);
export type Rule = z.infer<typeof ruleSchema>;

export const destinationSchema = z
  .object({
    /** Stable key, never shown as a path. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'use lowercase letters, digits and dashes'),
    /** Folder (folders and hybrid mode). */
    path: folder.optional(),
    /** Category link such as "[[Books]]" (properties and hybrid mode). */
    category: z.string().min(1).optional(),
    /** What belongs here, in the vault's language; fed to the classifier verbatim. */
    description: z.string().default(''),
    layout: z.enum(LAYOUTS).default('flat'),
    /** When several destinations' rules match a note, the highest priority wins (then the first). */
    priority: z.number().int().default(0),
    match: z.array(ruleSchema).default([]),
    /** Paths of anchor notes that clearly belong here. */
    examples: z.array(z.string()).default([]),
  })
  .strict();
export type Destination = z.infer<typeof destinationSchema>;

const jdCategory = z.object({ id: z.string().regex(/^\d{2}$/), name: z.string().min(1) }).strict();
const jdArea = z
  .object({ id: z.string().regex(/^\d{2}-\d{2}$/), name: z.string().min(1), categories: z.array(jdCategory).default([]) })
  .strict();

export const charterSchema = z
  .object({
    version: z.literal(1),
    /** Bumped by the plugin whenever it writes a semantically changed charter. */
    revision: z.number().int().nonnegative().default(1),
    preset: z.enum(PRESET_IDS),
    /** BCP-47 language of folder names and prose, e.g. "cs" or "en". */
    language: z.string().min(2).default('en'),
    mode: z.enum(CHARTER_MODES).default('folders'),
    inbox: folder.optional(),
    destinations: z.array(destinationSchema).min(1),
    system: z
      .object({
        attachments: folder.optional(),
        templates: folder.optional(),
        daily: z.object({ path: folder, filename: z.string().min(1).default('YYYY-MM-DD') }).strict().optional(),
      })
      .strict()
      .default({}),
    /** Globs the plugin never touches. */
    ignore: z.array(z.string().min(1)).default([]),
    conventions: z
      .object({
        filenames: z
          .object({ style: z.enum(['keep', 'sentence', 'title', 'kebab']).default('keep'), datePrefix: z.boolean().optional() })
          .strict()
          .optional(),
        properties: z
          .object({
            required: z.array(z.string().min(1)).default([]),
            enums: z.record(z.string(), z.array(scalar)).optional(),
          })
          .strict()
          .optional(),
        tags: z
          .object({
            style: z.enum(['keep', 'lowercase-kebab']).default('keep'),
            nested: z.boolean().default(true),
            maxPerNote: z.number().int().positive().optional(),
            canonical: z.record(z.string(), z.string()).optional(),
          })
          .strict()
          .optional(),
        links: z
          .object({ relatedHeading: z.string().min(1).default('## Related'), minOutgoing: z.number().int().nonnegative().optional() })
          .strict()
          .optional(),
      })
      .strict()
      .default({}),
    mocs: z
      .object({ enabled: z.boolean().default(false), perDestination: z.boolean().default(true), folder: folder.optional() })
      .strict()
      .optional(),
    drift: z
      .object({ inboxMaxAgeDays: z.number().int().positive().default(14), checkOnStartup: z.boolean().default(false) })
      .strict()
      .default({ inboxMaxAgeDays: 14, checkOnStartup: false }),
    jd: z.object({ areas: z.array(jdArea).min(1) }).strict().optional(),
  })
  .strict()
  .superRefine((charter, ctx) => {
    const ids = new Set<string>();
    charter.destinations.forEach((destination, index) => {
      const path = ['destinations', index];
      if (ids.has(destination.id)) ctx.addIssue({ code: 'custom', path: [...path, 'id'], message: `duplicate destination id "${destination.id}"` });
      ids.add(destination.id);
      if (charter.mode !== 'properties' && destination.path === undefined && destination.category === undefined) {
        ctx.addIssue({ code: 'custom', path, message: 'needs a path (or a category in hybrid mode)' });
      }
      if (charter.mode === 'properties' && destination.path === undefined && destination.category === undefined) {
        ctx.addIssue({ code: 'custom', path, message: 'needs a category or a path' });
      }
      if (charter.inbox !== undefined && destination.path === charter.inbox) {
        ctx.addIssue({ code: 'custom', path: [...path, 'path'], message: 'must differ from the inbox folder' });
      }
    });
    for (const [areaIndex, area] of (charter.jd?.areas ?? []).entries()) {
      const [low, high] = area.id.split('-').map(Number);
      for (const [categoryIndex, category] of area.categories.entries()) {
        const value = Number(category.id);
        if (low !== undefined && high !== undefined && (value < low || value > high)) {
          ctx.addIssue({
            code: 'custom',
            path: ['jd', 'areas', areaIndex, 'categories', categoryIndex, 'id'],
            message: `category ${category.id} is outside area ${area.id}`,
          });
        }
      }
    }
  });

export type Charter = z.infer<typeof charterSchema>;
/** Input shape (defaults optional), for presets and tests. */
export type CharterInput = z.input<typeof charterSchema>;
