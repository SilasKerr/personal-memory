import { readFile, readdir } from 'node:fs/promises';
import { commitMetadataSchema, commitSchema, type Commit } from '../domain/schemas.js';
import { createAtomic } from '../storage/atomic-file.js';
import { parseMarkdown, serializeMarkdown } from '../storage/markdown.js';
import { Vault } from '../storage/vault.js';
import { AlreadyExistsError, hasFileCode } from './errors.js';

export class CommitRepository {
  constructor(private readonly vault: Vault) {}

  async create(commit: Commit): Promise<void> {
    const validated = commitSchema.parse(commit);
    const { id, project_id, sequence, previous_commit } = validated.metadata;
    const file = this.vault.commitFile(project_id, id);
    if (await this.get(project_id, id)) throw new AlreadyExistsError('Commit', id);
    const existing = await this.list(project_id);
    const latest = existing.at(-1);
    if (sequence !== (latest?.metadata.sequence ?? 0) + 1 || previous_commit !== (latest?.metadata.id ?? null)) {
      throw new Error('Commit must follow the latest Commit in a linear sequence');
    }
    await this.vault.ensureCommitsDirectory(project_id);
    try {
      await createAtomic(file, serializeMarkdown(validated.metadata, validated.body, commitMetadataSchema));
    } catch (error) {
      if (hasFileCode(error, 'EEXIST')) throw new AlreadyExistsError('Commit', id);
      throw error;
    }
  }

  async get(projectId: string, commitId: string): Promise<Commit | null> {
    const file = this.vault.commitFile(projectId, commitId);
    try {
      await this.vault.assertExistingPathInsideRoot(file);
      const commit = parseMarkdown(await readFile(file, 'utf8'), commitMetadataSchema);
      if (commit.metadata.id !== commitId || commit.metadata.project_id !== projectId) {
        throw new Error('Commit metadata does not match its path');
      }
      return commitSchema.parse(commit);
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async list(projectId: string): Promise<Commit[]> {
    const directory = this.vault.commitsDirectory(projectId);
    let names: string[];
    try {
      await this.vault.assertExistingPathInsideRoot(directory);
      names = await readdir(directory);
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return [];
      throw error;
    }
    const commits: Commit[] = [];
    for (const name of names.filter((name) => name.endsWith('.md'))) {
      const commit = await this.get(projectId, name.slice(0, -3));
      if (commit) commits.push(commit);
    }
    commits.sort((a, b) => a.metadata.sequence - b.metadata.sequence);
    for (const [index, commit] of commits.entries()) {
      if (commit.metadata.sequence !== index + 1 || commit.metadata.previous_commit !== (commits[index - 1]?.metadata.id ?? null)) {
        throw new Error('Stored Commit history is not linear');
      }
    }
    return commits;
  }
}
