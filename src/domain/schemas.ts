import { z } from 'zod';

export const idSchema = z.string().regex(/^[a-z0-9-]+$/, 'ID must contain only lowercase letters, digits, and hyphens');
const timestampSchema = z.iso.datetime({ offset: true });
const idListSchema = z.array(idSchema);

export const projectMetadataSchema = z.strictObject({
  type: z.literal('project'),
  id: idSchema,
  name: z.string().min(1),
  status: z.enum(['active', 'paused', 'completed', 'archived']),
  revision: z.number().int().positive(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  latest_commit: idSchema.nullable(),
});
export const projectSchema = z.strictObject({ metadata: projectMetadataSchema, body: z.string() });
export type ProjectMetadata = z.infer<typeof projectMetadataSchema>;
export type Project = z.infer<typeof projectSchema>;

export const commitMetadataSchema = z.strictObject({
  type: z.literal('commit'),
  id: idSchema,
  project_id: idSchema,
  sequence: z.number().int().positive(),
  created_at: timestampSchema,
  previous_commit: idSchema.nullable(),
}).superRefine((metadata, context) => {
  if (metadata.sequence === 1 && metadata.previous_commit !== null) {
    context.addIssue({ code: 'custom', path: ['previous_commit'], message: 'The first Commit has no predecessor' });
  }
  if (metadata.sequence > 1 && metadata.previous_commit === null) {
    context.addIssue({ code: 'custom', path: ['previous_commit'], message: 'Later Commits need a predecessor' });
  }
});
export const commitSchema = z.strictObject({ metadata: commitMetadataSchema, body: z.string() });
export type CommitMetadata = z.infer<typeof commitMetadataSchema>;
export type Commit = z.infer<typeof commitSchema>;

export const experienceMetadataSchema = z.strictObject({
  type: z.literal('experience'),
  id: idSchema,
  status: z.enum(['candidate', 'validated', 'principle']),
  lifecycle: z.enum(['active', 'merged', 'superseded']),
  revision: z.number().int().positive(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  source_projects: idListSchema,
  source_commits: idListSchema,
  supersedes: idListSchema,
  superseded_by: idSchema.nullable(),
  merged_from: idListSchema,
  merged_into: idSchema.nullable(),
  abstracted_from: idListSchema,
  tags: z.array(z.string()),
}).superRefine((metadata, context) => {
  if (metadata.lifecycle === 'merged' && metadata.merged_into === null) {
    context.addIssue({ code: 'custom', path: ['merged_into'], message: 'Merged Experience needs merged_into' });
  }
  if (metadata.lifecycle === 'superseded' && metadata.superseded_by === null) {
    context.addIssue({ code: 'custom', path: ['superseded_by'], message: 'Superseded Experience needs superseded_by' });
  }
});
export const experienceSchema = z.strictObject({ metadata: experienceMetadataSchema, body: z.string() });
export type ExperienceMetadata = z.infer<typeof experienceMetadataSchema>;
export type Experience = z.infer<typeof experienceSchema>;

export const ignoredItemSchema = z.strictObject({ summary: z.string().min(1), reason: z.string().min(1) });
export type IgnoredItem = z.infer<typeof ignoredItemSchema>;

export const experienceStatusSchema = z.enum(['candidate', 'validated', 'principle']);
const newExperienceInputSchema = z.strictObject({
  title: z.string().min(1), body: z.string(), status: experienceStatusSchema.optional(), tags: z.array(z.string()).optional(),
});
export const experienceProposalSchema = z.discriminatedUnion('action', [
  newExperienceInputSchema.extend({ action: z.literal('create') }),
  z.strictObject({ action: z.literal('enrich'), target_id: idSchema, body: z.string(), status: experienceStatusSchema.optional(), tags: z.array(z.string()).optional() }),
  z.strictObject({ action: z.literal('supersede'), target_id: idSchema, replacement: newExperienceInputSchema }),
  z.strictObject({ action: z.literal('merge'), source_ids: z.array(idSchema).min(2).refine((ids) => new Set(ids).size === ids.length, 'source_ids must be distinct'), result: newExperienceInputSchema }),
]);
export type ExperienceProposal = z.infer<typeof experienceProposalSchema>;

export const saveProposalSchema = z.strictObject({
  project_id: idSchema,
  project_update: z.strictObject({
    name: z.string().min(1).optional(),
    status: projectMetadataSchema.shape.status.optional(),
    body: z.string().optional(),
  }).optional(),
  commit: z.strictObject({ title: z.string().min(1), body: z.string() }).optional(),
  experience_changes: z.array(experienceProposalSchema),
  ignored_items: z.array(ignoredItemSchema),
});
export type SaveProposal = z.infer<typeof saveProposalSchema>;

export const preparedExperienceChangeSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('create'), purpose: z.enum(['create', 'supersede', 'merge']), result: experienceSchema }),
  z.strictObject({ action: z.literal('update'), purpose: z.enum(['enrich', 'supersede', 'merge']), target_id: idSchema, base_revision: z.number().int().positive(), result: experienceSchema }),
]);
export type PreparedExperienceChange = z.infer<typeof preparedExperienceChangeSchema>;

export const changeSetSchema = z.strictObject({
  id: idSchema,
  status: z.enum(['pending', 'applied', 'rejected']),
  created_at: timestampSchema,
  applied_at: timestampSchema.nullable(),
  rejected_at: timestampSchema.nullable(),
  project_id: idSchema,
  base_project_revision: z.number().int().positive(),
  base_commit_id: idSchema.nullable(),
  base_commit_sequence: z.number().int().nonnegative(),
  project_change: z.strictObject({
    base_revision: z.number().int().positive(),
    changed_fields: z.array(z.enum(['name', 'status', 'body', 'latest_commit'])),
    result: projectSchema,
  }).nullable(),
  commit_change: commitSchema.nullable(),
  experience_changes: z.array(preparedExperienceChangeSchema),
  ignored_items: z.array(ignoredItemSchema),
}).superRefine((value, context) => {
  if (value.status === 'pending' && (value.applied_at !== null || value.rejected_at !== null)) context.addIssue({ code: 'custom', message: 'Pending ChangeSet cannot have completion timestamps' });
  if (value.status === 'applied' && (value.applied_at === null || value.rejected_at !== null)) context.addIssue({ code: 'custom', message: 'Applied ChangeSet needs applied_at only' });
  if (value.status === 'rejected' && (value.rejected_at === null || value.applied_at !== null)) context.addIssue({ code: 'custom', message: 'Rejected ChangeSet needs rejected_at only' });
});
export type ChangeSet = z.infer<typeof changeSetSchema>;
