import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import type { SaveProposal } from '../src/domain/schemas.js';
import { ChangeSetRepository } from '../src/repositories/changeset-repository.js';
import { CommitRepository } from '../src/repositories/commit-repository.js';
import { ConflictError, VaultLockedError } from '../src/repositories/errors.js';
import { ExperienceRepository } from '../src/repositories/experience-repository.js';
import { ProjectRepository } from '../src/repositories/project-repository.js';
import { ChangeSetService } from '../src/services/changeset-service.js';
import { previewChangeSet } from '../src/services/preview.js';
import { commit, experience, project, withVault } from './fixtures.js';

function proposal(changes: Partial<SaveProposal> = {}): SaveProposal {
  return { project_id: 'personal-memory', experience_changes: [], ignored_items: [], ...changes };
}

test('prepare stores a pending ChangeSet without changing formal knowledge', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  const commits = new CommitRepository(vault);
  const experiences = new ExperienceRepository(vault);
  const changeSets = new ChangeSetRepository(vault);
  await projects.create(project());
  const originalFile = await readFile(vault.projectFile('personal-memory'), 'utf8');
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({
    project_update: { status: 'paused', body: '# Paused\n' },
    commit: { title: 'Milestone 2', body: '## Stage Goal\nBuild lifecycle.\n' },
    experience_changes: [{ action: 'create', title: 'Use a semantic API', body: 'A reusable conclusion.', tags: ['memory'] }],
    ignored_items: [{ summary: 'A temporary note', reason: 'No long-term value' }],
  }));
  assert.equal(prepared.status, 'pending');
  assert.equal(prepared.project_change?.base_revision, 1);
  assert.equal(prepared.project_change?.result.metadata.revision, 2);
  assert.deepEqual(prepared.project_change?.changed_fields, ['status', 'body', 'latest_commit']);
  assert.equal(prepared.commit_change?.metadata.sequence, 1);
  assert.equal(prepared.commit_change?.metadata.previous_commit, null);
  assert.equal(prepared.experience_changes[0].action, 'create');
  assert.equal(prepared.experience_changes[0].result.metadata.revision, 1);
  assert.deepEqual(prepared.ignored_items, [{ summary: 'A temporary note', reason: 'No long-term value' }]);
  assert.deepEqual(await changeSets.get(prepared.id), prepared);
  assert.equal(await readFile(vault.projectFile('personal-memory'), 'utf8'), originalFile);
  assert.deepEqual(await commits.list('personal-memory'), []);
  assert.deepEqual(await experiences.list(), []);
  const preview = previewChangeSet(prepared);
  assert.equal(preview.commit?.title, 'Milestone 2');
  assert.equal(preview.experiences[0].purpose, 'create');
  assert.equal(preview.ignored_items[0].reason, 'No long-term value');
}));

test('apply writes prepared Project, Commit, and Experience once', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  const commits = new CommitRepository(vault);
  const experiences = new ExperienceRepository(vault);
  await projects.create(project());
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({
    project_update: { name: 'Personal Memory v1' },
    commit: { title: 'First stage', body: 'Findings.\n' },
    experience_changes: [{ action: 'create', title: 'Reuse semantic APIs', body: 'Useful across projects.' }],
  }));
  const applied = await service.applyChangeSet(prepared.id);
  assert.equal(applied.status, 'applied');
  assert.ok(applied.applied_at);
  assert.equal((await projects.get('personal-memory'))?.metadata.revision, 2);
  assert.equal((await projects.get('personal-memory'))?.metadata.name, 'Personal Memory v1');
  assert.equal((await commits.list('personal-memory')).length, 1);
  assert.equal((await experiences.list()).length, 1);
  assert.equal((await new ChangeSetRepository(vault).get(prepared.id))?.status, 'applied');
  await assert.rejects(service.applyChangeSet(prepared.id), /ChangeSet is applied/);
}));

test('enrich, supersede, and merge expand into deterministic create/update changes', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  const experiences = new ExperienceRepository(vault);
  await experiences.create(experience({ id: 'enrich-me' }));
  await experiences.create(experience({ id: 'replace-me' }));
  await experiences.create(experience({ id: 'source-a' }));
  await experiences.create(experience({ id: 'source-b' }));
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({ experience_changes: [
    { action: 'enrich', target_id: 'enrich-me', body: '# Better\n\nMore evidence.', status: 'validated' },
    { action: 'supersede', target_id: 'replace-me', replacement: { title: 'New replacement', body: 'Updated conclusion.' } },
    { action: 'merge', source_ids: ['source-a', 'source-b'], result: { title: 'Combined lesson', body: 'Combined evidence.' } },
  ] }));
  assert.deepEqual(prepared.experience_changes.map((change) => `${change.purpose}:${change.action}`), [
    'enrich:update', 'supersede:create', 'supersede:update', 'merge:create', 'merge:update', 'merge:update',
  ]);
  const supersedeCreate = prepared.experience_changes[1].result;
  const supersedeUpdate = prepared.experience_changes[2].result;
  assert.deepEqual(supersedeCreate.metadata.supersedes, ['replace-me']);
  assert.equal(supersedeUpdate.metadata.superseded_by, supersedeCreate.metadata.id);
  assert.equal(supersedeUpdate.metadata.lifecycle, 'superseded');
  const mergeCreate = prepared.experience_changes[3].result;
  assert.deepEqual(mergeCreate.metadata.merged_from, ['source-a', 'source-b']);
  assert.equal(prepared.experience_changes[4].result.metadata.merged_into, mergeCreate.metadata.id);
  assert.equal(prepared.experience_changes[5].result.metadata.merged_into, mergeCreate.metadata.id);
  assert.deepEqual(previewChangeSet(prepared).experiences.map((item) => item.purpose), ['enrich', 'supersede', 'supersede', 'merge', 'merge', 'merge']);
  assert.equal((await experiences.get('replace-me'))?.metadata.lifecycle, 'active');
  await service.applyChangeSet(prepared.id);
  assert.equal((await experiences.get('enrich-me'))?.metadata.revision, 2);
  assert.equal((await experiences.get('enrich-me'))?.metadata.status, 'validated');
  assert.equal((await experiences.get('replace-me'))?.metadata.lifecycle, 'superseded');
  assert.equal((await experiences.get('source-a'))?.metadata.lifecycle, 'merged');
  assert.equal((await experiences.get('source-b'))?.metadata.lifecycle, 'merged');
  assert.ok(await experiences.get(mergeCreate.metadata.id));
}));

test('Experience title slug receives a simple suffix on collision', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await new ExperienceRepository(vault).create(experience({ id: 'same-title' }));
  const prepared = await new ChangeSetService(vault).prepareSave(proposal({ experience_changes: [
    { action: 'create', title: 'Same Title', body: 'First.' },
    { action: 'create', title: 'Same Title', body: 'Second.' },
  ] }));
  assert.deepEqual(prepared.experience_changes.map((change) => change.result.metadata.id), ['same-title-2', 'same-title-3']);
}));

test('prepare computes the next Commit sequence and predecessor from stored history', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await new CommitRepository(vault).create(commit());
  const prepared = await new ChangeSetService(vault).prepareSave(proposal({ commit: { title: 'Second stage', body: 'Content' } }));
  assert.equal(prepared.base_commit_id, 'pm-0001');
  assert.equal(prepared.base_commit_sequence, 1);
  assert.equal(prepared.commit_change?.metadata.sequence, 2);
  assert.equal(prepared.commit_change?.metadata.previous_commit, 'pm-0001');
}));

test('Project revision conflict leaves formal knowledge unchanged and releases lock', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({ project_update: { status: 'paused' } }));
  await projects.update(project({ revision: 2, updated_at: '2026-09-25T00:00:00Z', status: 'completed' }));
  await assert.rejects(service.applyChangeSet(prepared.id), ConflictError);
  assert.equal((await projects.get('personal-memory'))?.metadata.status, 'completed');
  await assert.rejects(readFile(vault.writeLockFile(), 'utf8'), { code: 'ENOENT' });
}));

test('Experience revision and create-ID conflicts are detected before writes', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  const experiences = new ExperienceRepository(vault);
  await experiences.create(experience({ id: 'target' }));
  const service = new ChangeSetService(vault);
  const enrich = await service.prepareSave(proposal({ experience_changes: [{ action: 'enrich', target_id: 'target', body: 'New body' }] }));
  await experiences.update(experience({ id: 'target', revision: 2, updated_at: '2026-09-25T00:00:00Z' }));
  await assert.rejects(service.applyChangeSet(enrich.id), ConflictError);
  const create = await service.prepareSave(proposal({ project_update: { status: 'paused' }, experience_changes: [{ action: 'create', title: 'Reserved ID', body: 'Content' }] }));
  await experiences.create(experience({ id: 'reserved-id' }));
  await assert.rejects(service.applyChangeSet(create.id), ConflictError);
  assert.equal((await new ChangeSetRepository(vault).get(create.id))?.status, 'pending');
  assert.equal((await new ProjectRepository(vault).get('personal-memory'))?.metadata.status, 'active');
}));

test('Commit history conflict is detected without applying Project changes', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({ commit: { title: 'Prepared', body: 'Content' } }));
  await new CommitRepository(vault).create(commit({ id: 'another-first' }));
  await assert.rejects(service.applyChangeSet(prepared.id), ConflictError);
  assert.equal((await projects.get('personal-memory'))?.metadata.revision, 1);
}));

test('reject changes only the ChangeSet and prevents apply', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  const original = await readFile(vault.projectFile('personal-memory'), 'utf8');
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({ project_update: { status: 'paused' } }));
  const rejected = await service.rejectChangeSet(prepared.id);
  assert.equal(rejected.status, 'rejected');
  assert.ok(rejected.rejected_at);
  assert.equal(await readFile(vault.projectFile('personal-memory'), 'utf8'), original);
  await assert.rejects(service.applyChangeSet(prepared.id), /ChangeSet is rejected/);
  await assert.rejects(service.rejectChangeSet(prepared.id), /ChangeSet is rejected/);
}));

test('held write lock blocks apply and ordinary failure releases it', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({ project_update: { status: 'paused' } }));
  await writeFile(vault.writeLockFile(), 'held', { flag: 'wx' });
  await assert.rejects(service.applyChangeSet(prepared.id), VaultLockedError);
  await rm(vault.writeLockFile());
  await service.applyChangeSet(prepared.id);
  await assert.rejects(readFile(vault.writeLockFile(), 'utf8'), { code: 'ENOENT' });
}));
