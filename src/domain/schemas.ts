import { z } from 'zod';

export const idSchema = z.string().regex(/^[a-z0-9-]+$/);
export const opaqueProjectIdSchema = z.string().regex(/^prj-[0-9a-f]{32}$/);
export const opaqueCommitIdSchema = z.string().regex(/^cmt-[0-9a-f]{32}$/);
export const opaqueExperienceIdSchema = z.string().regex(/^exp-[0-9a-f]{32}$/);
export const timestampSchema = z.iso.datetime({ offset: true });
const nonblank = z.string().trim().min(1).refine((value) => !/^(暂无|无|n\/a)$/i.test(value), 'Placeholder content is not allowed');
const singleLine = nonblank.refine((value) => !/[\r\n]/.test(value), 'Must be one line');
const items = z.array(singleLine);
const uniqueIds = z.array(idSchema).refine((v) => new Set(v).size === v.length, 'Duplicate ID');

export const projectContentSchema = z.strictObject({
  name: singleLine, goal: nonblank, current_state: nonblank,
  confirmed_decisions: items, open_questions: items, next_steps: items,
  lifecycle: z.enum(['active', 'paused', 'completed', 'archived']),
});
export type ProjectContent = z.infer<typeof projectContentSchema>;
export const projectMetadataSchema = z.strictObject({
  type: z.literal('project'), id: opaqueProjectIdSchema, revision: z.number().int().positive(),
  created_at: timestampSchema, updated_at: timestampSchema,
});
export const projectSchema = z.strictObject({ metadata: projectMetadataSchema, content: projectContentSchema });
export type Project = z.infer<typeof projectSchema>;

export const commitContentSchema = z.strictObject({
  title: singleLine, stage_goal: nonblank.optional(), starting_point: nonblank,
  key_findings: items.optional(), turning_points: items.optional(),
  decisions: items.optional(), rejected_approaches: items.optional(),
  ending_state: nonblank, open_questions: items.optional(), next_steps: items.optional(),
}).refine((v) => ['key_findings', 'turning_points', 'decisions', 'rejected_approaches']
  .some((key) => ((v as Record<string, unknown>)[key] as string[] | undefined)?.length), 'Commit needs a cognitive change');
export type CommitContent = z.infer<typeof commitContentSchema>;
export const commitOperationSchema = z.strictObject({
  action: z.enum(['create', 'enrich']), experience_id: idSchema,
});
export const commitMetadataSchema = z.strictObject({
  type: z.literal('commit'), id: opaqueCommitIdSchema, project_id: opaqueProjectIdSchema,
  sequence: z.number().int().positive(), created_at: timestampSchema,
  revises_commit_ids: uniqueIds, experience_changes: z.array(commitOperationSchema),
});
export const commitSchema = z.strictObject({ metadata: commitMetadataSchema, content: commitContentSchema });
export type Commit = z.infer<typeof commitSchema>;

export const experienceContentSchema = z.strictObject({
  title: singleLine, core_statement: nonblank,
  context: nonblank.optional(), evidence: nonblank.optional(),
  applies_when: nonblank.optional(), limitations: nonblank.optional(),
  recommended_action: nonblank.optional(),
  maturity: z.enum(['candidate', 'validated', 'principle']),
});
export type ExperienceContent = z.infer<typeof experienceContentSchema>;
export const experienceMetadataSchema = z.strictObject({
  type: z.literal('experience'), id: opaqueExperienceIdSchema, source_commits: uniqueIds,
  revision: z.number().int().positive(), created_at: timestampSchema, updated_at: timestampSchema,
});
export const experienceSchema = z.strictObject({ metadata: experienceMetadataSchema, content: experienceContentSchema });
export type Experience = z.infer<typeof experienceSchema>;

export const ignoredItemSchema = z.strictObject({ summary: nonblank, reason: nonblank });
export type IgnoredItem = z.infer<typeof ignoredItemSchema>;
export const experienceProposalSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), target: experienceContentSchema, source_commits: uniqueIds.optional() }),
  z.strictObject({
    action: z.literal('enrich'), target_id: idSchema, base_revision: z.number().int().positive(),
    target: experienceContentSchema, source_commits: uniqueIds.optional(),
  }),
]);
export type ExperienceProposal = z.infer<typeof experienceProposalSchema>;
export const saveProposalSchema = z.strictObject({
  project_id: idSchema.nullable(),
  base_project_revision: z.number().int().nonnegative(),
  base_commit_head: idSchema.nullable(),
  change_kind: z.enum(['historical_change', 'maintenance_correction']),
  external_change: z.enum(['adopt', 'reconcile']).optional(),
  project_target: projectContentSchema,
  commit: z.strictObject({ content: commitContentSchema, revises_commit_ids: uniqueIds.optional() }).optional(),
  experiences: z.array(experienceProposalSchema),
  ignored_items: z.array(ignoredItemSchema).optional(),
});
export type SaveProposal = z.infer<typeof saveProposalSchema>;

export const preparedExperienceChangeSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('create'), id: idSchema, target: experienceContentSchema, source_commits: uniqueIds,
  }),
  z.strictObject({
    action: z.literal('enrich'), id: idSchema, base_revision: z.number().int().positive(),
    base_fingerprint: z.string().length(64), target: experienceContentSchema, source_commits: uniqueIds,
  }),
]);
export type PreparedExperienceChange = z.infer<typeof preparedExperienceChangeSchema>;
export const changeSetSchema = z.strictObject({
  id: idSchema,
  status: z.enum(['pending', 'applied', 'rejected', 'conflicted']),
  prepared_at: timestampSchema, completed_at: timestampSchema.nullable(),
  project_id: idSchema,
  project_is_new: z.boolean(),
  external_change: z.enum(['adopt', 'reconcile']).nullable(),
  base_project_revision: z.number().int().nonnegative(),
  base_project_fingerprint: z.string().length(64),
  base_commit_head: idSchema.nullable(),
  base_commit_sequence: z.number().int().nonnegative(),
  change_kind: z.enum(['historical_change', 'maintenance_correction']),
  project_change: z.strictObject({ changed_fields: z.array(z.string()), target: projectContentSchema }).nullable(),
  commit_change: z.strictObject({
    id: idSchema, sequence: z.number().int().positive(), content: commitContentSchema,
    revises_commit_ids: uniqueIds, experience_changes: z.array(commitOperationSchema),
  }).nullable(),
  experience_changes: z.array(preparedExperienceChangeSchema),
  ignored_items: z.array(ignoredItemSchema),
}).superRefine((value, context) => {
  if ((value.status === 'pending') !== (value.completed_at === null)) {
    context.addIssue({ code: 'custom', path: ['completed_at'], message: 'Completion time must match terminal status' });
  }
  if (value.project_is_new && (value.base_project_revision !== 0 || !value.project_change)) {
    context.addIssue({ code: 'custom', path: ['project_change'], message: 'New Project requires a creation target' });
  }
});
export type ChangeSet = z.infer<typeof changeSetSchema>;
