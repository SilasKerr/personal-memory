import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Commit, Experience, Project, SaveProposal } from '../src/domain/schemas.js';
import { Vault } from '../src/storage/vault.js';

export const projectId = 'prj-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const commitId = 'cmt-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const experienceId = 'exp-cccccccccccccccccccccccccccccccc';
const at = '2026-09-24T00:00:00.000Z';

export function project(overrides: Partial<Project> = {}): Project {
  return {
    metadata: { type: 'project', id: projectId, revision: 1, created_at: at, updated_at: at, ...overrides.metadata },
    content: {
      name: 'Personal Memory', goal: 'Reliable project memory', current_state: 'Designing v1',
      confirmed_decisions: [], open_questions: [], next_steps: ['Build v1'], lifecycle: 'active',
      ...overrides.content,
    },
  };
}

export function commit(overrides: Partial<Commit> = {}): Commit {
  return {
    metadata: {
      type: 'commit', id: commitId, project_id: projectId, sequence: 1, created_at: at,
      revises_commit_ids: [], experience_changes: [], ...overrides.metadata,
    },
    content: {
      title: 'Initial understanding', starting_point: 'No durable memory', key_findings: ['Need project context'],
      ending_state: 'A project-first design', ...overrides.content,
    },
  };
}

export function experience(overrides: Partial<Experience> = {}): Experience {
  return {
    metadata: {
      type: 'experience', id: experienceId, revision: 1, created_at: at, updated_at: at,
      source_commits: [commitId], ...overrides.metadata,
    },
    content: {
      title: 'Use semantic interfaces', core_statement: 'Agents should save through semantic APIs',
      maturity: 'candidate', ...overrides.content,
    },
  };
}

export function proposal(overrides: Partial<SaveProposal> = {}): SaveProposal {
  return {
    project_id: projectId, base_project_revision: 1, base_commit_head: null,
    change_kind: 'historical_change', project_target: project().content,
    experiences: [], ignored_items: [], ...overrides,
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
