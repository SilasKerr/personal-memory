import { renderCommit, renderExperience, renderProject } from '../domain/markdown-content.js';
import { changeSetSchema, type ChangeSet, type IgnoredItem } from '../domain/schemas.js';

export interface MemoryCommitPreview {
  changeset_id: string;
  project: { id: string; changed_fields: string[]; next_revision: number; target_markdown: string } | null;
  commit: { id: string; sequence: number; title: string; markdown: string } | null;
  experiences: Array<{
    action: 'create' | 'enrich'; id: string; title: string; maturity: string;
    source_commits: string[]; markdown: string;
  }>;
  ignored_items: IgnoredItem[];
}

export function previewChangeSet(input: ChangeSet): MemoryCommitPreview {
  const changeSet = changeSetSchema.parse(input);
  return {
    changeset_id: changeSet.id,
    project: changeSet.project_change ? {
      id: changeSet.project_id, changed_fields: changeSet.project_change.changed_fields,
      next_revision: changeSet.base_project_revision + 1,
      target_markdown: renderProject(changeSet.project_change.target),
    } : null,
    commit: changeSet.commit_change ? {
      id: changeSet.commit_change.id, sequence: changeSet.commit_change.sequence,
      title: changeSet.commit_change.content.title,
      markdown: renderCommit(changeSet.commit_change.content),
    } : null,
    experiences: changeSet.experience_changes.map((item) => ({
      action: item.action, id: item.id, title: item.target.title, maturity: item.target.maturity,
      source_commits: item.source_commits, markdown: renderExperience(item.target),
    })),
    ignored_items: changeSet.ignored_items,
  };
}
