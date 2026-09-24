import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { CommitRepository } from '../src/repositories/commit-repository.js';
import { AlreadyExistsError, NotFoundError } from '../src/repositories/errors.js';
import { ExperienceRepository } from '../src/repositories/experience-repository.js';
import { ProjectRepository } from '../src/repositories/project-repository.js';
import { commit, experience, project, withVault } from './fixtures.js';

test('Project Repository creates, gets, and checks existence without overwriting', async () => withVault(async (vault) => {
  const repository = new ProjectRepository(vault);
  const original = project();
  assert.equal(await repository.get(original.metadata.id), null);
  assert.equal(await repository.exists(original.metadata.id), false);
  await repository.create(original);
  assert.deepEqual(await repository.get(original.metadata.id), original);
  assert.equal(await repository.exists(original.metadata.id), true);
  await assert.rejects(repository.create(original), AlreadyExistsError);
  assert.match(await readFile(vault.projectFile(original.metadata.id), 'utf8'), /^---\ntype: project\n/);
  await assert.rejects(repository.create(project({ revision: 2, id: 'new-project' })));
}));

test('Commit Repository appends a linear history, sorts by sequence, and has no update API', async () => withVault(async (vault) => {
  const repository = new CommitRepository(vault);
  const first = commit();
  const second = commit({ id: 'pm-0002', sequence: 2, previous_commit: 'pm-0001' });
  assert.equal(await repository.get('personal-memory', 'pm-0001'), null);
  assert.deepEqual(await repository.list('personal-memory'), []);
  await repository.create(first);
  await repository.create(second);
  assert.deepEqual(await repository.get('personal-memory', 'pm-0001'), first);
  assert.deepEqual((await repository.list('personal-memory')).map((item) => item.metadata.id), ['pm-0001', 'pm-0002']);
  assert.equal('update' in repository, false);
  await assert.rejects(repository.create(first), AlreadyExistsError);
  await assert.rejects(repository.create(commit({ id: 'pm-0004', sequence: 4, previous_commit: 'pm-0002' })));
  await assert.rejects(repository.create(commit({ id: 'pm-0003', sequence: 3, previous_commit: 'pm-0001' })));
}));

test('Commit list uses sequence even when filenames sort in reverse order', async () => withVault(async (vault) => {
  const repository = new CommitRepository(vault);
  await repository.create(commit({ id: 'z-first' }));
  await repository.create(commit({ id: 'a-second', sequence: 2, previous_commit: 'z-first' }));
  assert.deepEqual((await repository.list('personal-memory')).map((item) => item.metadata.id), ['z-first', 'a-second']);
}));

test('Experience Repository creates, lists, updates, and preserves relation arrays', async () => withVault(async (vault) => {
  const repository = new ExperienceRepository(vault);
  const original = experience({
    source_projects: ['personal-memory', 'other-project'], source_commits: ['pm-0001'],
    supersedes: ['old-one'], merged_from: ['fragment-one'], abstracted_from: ['specific-one'], tags: ['agents', 'memory'],
  });
  assert.equal(await repository.get(original.metadata.id), null);
  assert.deepEqual(await repository.list(), []);
  await repository.create(original);
  assert.deepEqual(await repository.get(original.metadata.id), original);
  await assert.rejects(repository.create(original), AlreadyExistsError);
  const updated = experience({ ...original.metadata, status: 'validated', revision: 2, updated_at: '2026-09-25T00:00:00Z' }, '# Revised\n\nNew body.\n');
  await repository.update(updated);
  assert.deepEqual(await repository.get(updated.metadata.id), updated);
  assert.deepEqual(await repository.list(), [updated]);
  await assert.rejects(repository.update(experience({ id: 'missing' })), NotFoundError);
  await assert.rejects(repository.update(experience({ ...updated.metadata, created_at: '2026-09-25T00:00:00Z' })));
  await assert.rejects(repository.update(experience({ ...updated.metadata, revision: 4, updated_at: '2026-09-26T00:00:00Z' })));
  await assert.rejects(repository.create(experience({ id: 'wrong-revision', revision: 2 })));
}));

test('Repository reads reject metadata that disagrees with file paths', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  await writeFile(vault.projectFile('personal-memory'), (await readFile(vault.projectFile('personal-memory'), 'utf8')).replace('id: personal-memory', 'id: another-project'));
  await assert.rejects(projects.get('personal-memory'));

  const commits = new CommitRepository(vault);
  await commits.create(commit());
  await writeFile(vault.commitFile('personal-memory', 'pm-0001'), (await readFile(vault.commitFile('personal-memory', 'pm-0001'), 'utf8')).replace('project_id: personal-memory', 'project_id: other-project'));
  await assert.rejects(commits.get('personal-memory', 'pm-0001'));

  const experiences = new ExperienceRepository(vault);
  await experiences.create(experience());
  await writeFile(vault.experienceFile('semantic-interfaces'), (await readFile(vault.experienceFile('semantic-interfaces'), 'utf8')).replace('id: semantic-interfaces', 'id: other-experience'));
  await assert.rejects(experiences.get('semantic-interfaces'));
}));

test('validated IDs and real paths prevent traversal and symlink escape', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  const commits = new CommitRepository(vault);
  const experiences = new ExperienceRepository(vault);
  await assert.rejects(projects.get('../escape'));
  await assert.rejects(commits.get('personal-memory', '../escape'));
  await assert.rejects(experiences.get('/absolute'));
  await assert.rejects(projects.create(project({ id: '../escape' })));
  await assert.rejects(commits.create(commit({ project_id: '../escape' })));
  await assert.rejects(experiences.create(experience({ id: '../escape' })));

  const outside = await mkdtemp(path.join(os.tmpdir(), 'personal-memory-outside-'));
  try {
    await symlink(outside, vault.projectDirectory('linked-project'));
    await assert.rejects(projects.create(project({ id: 'linked-project' })), /escapes Vault root/);
    await symlink(path.join(outside, 'external.md'), vault.experienceFile('linked-experience'));
    await writeFile(path.join(outside, 'external.md'), 'outside');
    await assert.rejects(experiences.get('linked-experience'), /escapes Vault root/);
    assert.equal(await readFile(path.join(outside, 'external.md'), 'utf8'), 'outside');
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
}));
