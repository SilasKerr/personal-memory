import { changeSetSchema, type ChangeSet, type IgnoredItem } from '../domain/schemas.js';

export interface MemoryCommitPreview {
  changeset_id: string;
  project: { id: string; changed_fields: string[]; next_revision: number; name: string; status: string; latest_commit: string | null; body: string | null } | null;
  commit: { id: string; title: string; sequence: number; body: string } | null;
  experiences: Array<{
    action: 'create' | 'update';
    purpose: 'create' | 'enrich' | 'supersede' | 'merge';
    id: string;
    title: string;
    target_id: string | null;
    body: string;
    lifecycle: string;
  }>;
  ignored_items: IgnoredItem[];
}

export function previewChangeSet(input: ChangeSet): MemoryCommitPreview {
  const changeSet = changeSetSchema.parse(input);
  return {
    changeset_id: changeSet.id,
    project: changeSet.project_change ? {
      id: changeSet.project_id,
      changed_fields: changeSet.project_change.changed_fields,
      next_revision: changeSet.project_change.result.metadata.revision,
      name: changeSet.project_change.result.metadata.name,
      status: changeSet.project_change.result.metadata.status,
      latest_commit: changeSet.project_change.result.metadata.latest_commit,
      body: changeSet.project_change.changed_fields.includes('body') ? changeSet.project_change.result.body : null,
    } : null,
    commit: changeSet.commit_change ? {
      id: changeSet.commit_change.metadata.id,
      title: heading(changeSet.commit_change.body),
      sequence: changeSet.commit_change.metadata.sequence,
      body: changeSet.commit_change.body,
    } : null,
    experiences: changeSet.experience_changes.map((change) => ({
      action: change.action,
      purpose: change.purpose,
      id: change.result.metadata.id,
      title: heading(change.result.body),
      target_id: change.action === 'update' ? change.target_id : null,
      body: change.result.body,
      lifecycle: change.result.metadata.lifecycle,
    })),
    ignored_items: changeSet.ignored_items,
  };
}

function heading(body: string): string {
  return /^# (.+)$/m.exec(body)?.[1] ?? '(untitled)';
}
