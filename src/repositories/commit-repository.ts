import { readFile, readdir } from 'node:fs/promises';
import { parseCommit, renderCommit } from '../domain/markdown-content.js';
import { commitMetadataSchema, commitSchema, type Commit } from '../domain/schemas.js';
import { createAtomic } from '../storage/atomic-file.js';
import { assertAccepted, baselineFor, writeBaseline } from '../storage/baseline.js';
import { parseMarkdown, serializeMarkdown } from '../storage/markdown.js';
import { Vault } from '../storage/vault.js';
import { AlreadyExistsError, ExternalChangePendingError, IntegrityError, hasFileCode } from './errors.js';

export function serializeCommit(commit: Commit): string {
  const validated = commitSchema.parse(commit);
  return serializeMarkdown(validated.metadata, renderCommit(validated.content), commitMetadataSchema);
}

export class CommitRepository {
  constructor(private readonly vault: Vault) {}

  async create(commit: Commit): Promise<void> {
    const validated = commitSchema.parse(commit);
    const { id, project_id, sequence } = validated.metadata;
    if (await this.get(project_id, id)) throw new AlreadyExistsError('Commit', id);
    const latest = (await this.list(project_id)).at(-1);
    if (sequence !== (latest?.metadata.sequence ?? 0) + 1) throw new Error('Commit must follow latest sequence');
    for (const ref of validated.metadata.revises_commit_ids) {
      const target = await this.get(project_id, ref);
      if (!target || target.metadata.sequence >= sequence) throw new Error('Invalid cognition revision reference');
    }
    await this.vault.ensureCommitsDirectory(project_id);
    try {
      await createAtomic(this.vault.commitFile(project_id, id), serializeCommit(validated));
      await writeBaseline(this.vault, 'commit', baselineFor(id, 1,
        { content: validated.content, revises_commit_ids: validated.metadata.revises_commit_ids,
          experience_changes: validated.metadata.experience_changes, sequence }, validated.metadata.created_at));
    } catch (error) {
      if (hasFileCode(error, 'EEXIST')) throw new AlreadyExistsError('Commit', id);
      throw error;
    }
  }

  async get(projectId: string, commitId: string): Promise<Commit | null> {
    const file = this.vault.commitFile(projectId, commitId);
    try {
      await this.vault.assertExistingPathInsideRoot(file);
      const parsed = parseMarkdown(await readFile(file, 'utf8'), commitMetadataSchema);
      if (parsed.metadata.id !== commitId || parsed.metadata.project_id !== projectId) throw new Error('Commit metadata does not match path');
      const commit = commitSchema.parse({ metadata: parsed.metadata, content: parseCommit(parsed.body) });
      try {
        await assertAccepted(this.vault, 'commit', commitId, 1, {
          content: commit.content, revises_commit_ids: commit.metadata.revises_commit_ids,
          experience_changes: commit.metadata.experience_changes, sequence: commit.metadata.sequence,
        }, commit.metadata.created_at);
      } catch (error) {
        if (error instanceof ExternalChangePendingError) throw new IntegrityError(`Commit historical semantics changed: ${commitId}`);
        throw error;
      }
      return commit;
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async list(projectId: string): Promise<Commit[]> {
    const directory = this.vault.commitsDirectory(projectId);
    try {
      await this.vault.assertExistingPathInsideRoot(directory);
      const names = await readdir(directory);
      const commits: Commit[] = [];
      for (const name of names.filter((name) => name.endsWith('.md'))) {
        const commit = await this.get(projectId, name.slice(0, -3));
        if (commit) commits.push(commit);
      }
      commits.sort((a, b) => a.metadata.sequence - b.metadata.sequence);
      for (const [index, commit] of commits.entries()) {
        if (commit.metadata.sequence !== index + 1) throw new Error('Stored Commit history has a gap or duplicate sequence');
      }
      return commits;
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return [];
      throw error;
    }
  }
}
