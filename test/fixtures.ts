import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Commit, Experience, Project } from '../src/domain/schemas.js';
import { defaultCommitBody, defaultExperienceBody, defaultProjectBody } from '../src/domain/templates.js';
import { Vault } from '../src/storage/vault.js';

const now = '2026-09-24T00:00:00Z';

export function project(metadata: Partial<Project['metadata']> = {}, body = defaultProjectBody('Personal Memory')): Project {
  return {
    metadata: {
      type: 'project', id: 'personal-memory', name: 'Personal Memory', status: 'active',
      revision: 1, created_at: now, updated_at: now, latest_commit: null, ...metadata,
    },
    body,
  };
}

export function commit(metadata: Partial<Commit['metadata']> = {}, body = defaultCommitBody('Initial understanding')): Commit {
  return {
    metadata: {
      type: 'commit', id: 'pm-0001', project_id: 'personal-memory', sequence: 1,
      created_at: now, previous_commit: null, ...metadata,
    },
    body,
  };
}

export function experience(metadata: Partial<Experience['metadata']> = {}, body = defaultExperienceBody('Use semantic interfaces')): Experience {
  return {
    metadata: {
      type: 'experience', id: 'semantic-interfaces', status: 'candidate', lifecycle: 'active',
      revision: 1, created_at: now, updated_at: now, source_projects: ['personal-memory'],
      source_commits: ['pm-0001'], supersedes: [], superseded_by: null,
      merged_from: [], merged_into: null, abstracted_from: [], tags: [], ...metadata,
    },
    body,
  };
}

export async function withVault<T>(work: (vault: Vault, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'personal-memory-'));
  try {
    const vault = new Vault(root);
    await vault.initialize();
    return await work(vault, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
