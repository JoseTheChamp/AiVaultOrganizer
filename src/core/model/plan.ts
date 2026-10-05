import * as z from 'zod';
import { err, ok, type Result } from './result';
import { type Operation, operationSchema } from './operation';

export const warningSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  opIds: z.array(z.string()).default([]),
});

export type PlanWarning = z.infer<typeof warningSchema>;

export const planSchema = z.object({
  /** Format version of the serialized plan. */
  version: z.literal(1),
  id: z.string().min(1),
  createdAt: z.string(),
  /** Charter revision the plan was computed against; 0 when no charter was involved. */
  charterRevision: z.number().int().nonnegative(),
  /** Prompt id → version used while planning, for reproducibility. */
  promptVersions: z.record(z.string(), z.number().int()).default({}),
  models: z.object({ chat: z.string().optional(), embedding: z.string().optional() }).default({}),
  operations: z.array(operationSchema),
  warnings: z.array(warningSchema).default([]),
});

export type Plan = z.infer<typeof planSchema>;

export interface PlanInput {
  id: string;
  createdAt: string;
  charterRevision?: number;
  operations: Operation[];
  warnings?: PlanWarning[];
  promptVersions?: Record<string, number>;
  models?: Plan['models'];
}

export function createPlan(input: PlanInput): Plan {
  return planSchema.parse({ version: 1, charterRevision: 0, ...input });
}

/** Parses a stored or hand-written plan; never throws on bad input. */
export function parsePlan(json: unknown): Result<Plan, string[]> {
  const parsed = planSchema.safeParse(json);
  if (parsed.success) return ok(parsed.data);
  return err(parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`));
}
