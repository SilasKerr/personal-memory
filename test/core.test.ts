import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { renderProject } from '../src/domain/markdown-content.js';
import { ChangeSetRepository } from '../src/repositories/changeset-repository.js';
import { CommitRepository } from '../src/repositories/commit-repository.js';
import { ExperienceRepository } from '../src/repositories/experience-repository.js';
import { ProjectRepository } from '../src/repositories/project-repository.js';
import { ChangeSetService } from '../src/services/changeset-service.js';
import { MemoryService } from '../src/services/memory-service.js';
import { assertNoIncompleteTransaction, plannedWrite, recoverTransaction } from '../src/storage/transaction.js';
import { withVaultWriteLock } from '../src/storage/write-lock.js';
import { commit, commitId, experience, experienceId, project, projectId, proposal, withVault } from './fixtures.js';

const stage = {
  content: {
    title: 'Established v1', starting_point: 'Only a draft', key_findings: ['Structured state is needed'],
    ending_state: 'Ready to build',
  },
};

test('repositories render structured Markdown, enforce sequence and path safety', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  assert.deepEqual(await projects.get(projectId), project());
  assert.match(await readFile(vault.projectFile(projectId), 'utf8'), /## Current State/);
  const commits = new CommitRepository(vault);
  await commits.create(commit());
  assert.equal((await commits.list(projectId))[0].metadata.sequence, 1);
  await assert.rejects(commits.create(commit({ metadata: { ...commit().metadata, id: 'cmt-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', sequence: 3 } })));
  await assert.rejects(projects.get('../outside'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'personal-memory-outside-'));
  try {
    const linkedId = 'prj-dddddddddddddddddddddddddddddddd';
    await symlink(outside, vault.projectDirectory(linkedId));
    await assert.rejects(projects.create(project({ metadata: { ...project().metadata, id: linkedId } })), /escapes Vault root/);
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test('prepare freezes IDs without domain writes; apply uses acceptance timestamps and is idempotent', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({
    project_target: { ...project().content, current_state: 'v1 implemented' },
    commit: stage,
    experiences: [{ action: 'create', target: { title: 'Keep memory deterministic', core_statement: 'Validate facts, do not reinterpret them', maturity: 'candidate' } }],
  }));
  assert.match(prepared.commit_change!.id, /^cmt-[0-9a-f]{32}$/);
  assert.match(prepared.experience_changes[0].id, /^exp-[0-9a-f]{32}$/);
  assert.equal((await projects.get(projectId))!.metadata.revision, 1);
  assert.equal((await new CommitRepository(vault).list(projectId)).length, 0);
  assert.equal((await new ExperienceRepository(vault).list()).length, 0);
  const applied = await service.applyChangeSet(prepared.id);
  assert.equal(applied.outcome, 'applied');
  assert.equal((await projects.get(projectId))!.metadata.revision, 2);
  const created = (await new ExperienceRepository(vault).list())[0];
  assert.equal(created.metadata.id, prepared.experience_changes[0].id);
  assert.deepEqual(created.metadata.source_commits, [prepared.commit_change!.id]);
  assert.equal(created.metadata.created_at, created.metadata.updated_at);
  assert.ok(Date.parse(created.metadata.created_at) >= Date.parse(prepared.prepared_at));
  const savedCommit = (await new CommitRepository(vault).list(projectId))[0];
  assert.equal(savedCommit.metadata.id, prepared.commit_change!.id);
  assert.deepEqual(savedCommit.metadata.experience_changes, [{ action: 'create', experience_id: created.metadata.id }]);
  assert.equal((await service.applyChangeSet(prepared.id)).outcome, 'already_applied');
  assert.equal((await new CommitRepository(vault).list(projectId)).length, 1);
  assert.equal((await new ExperienceRepository(vault).get(created.metadata.id))!.metadata.revision, 1);
}));

test('Project changes need Commit unless maintenance; Commit-only leaves Project revision alone', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  const service = new ChangeSetService(vault);
  await assert.rejects(service.prepareSave(proposal({ project_target: { ...project().content, goal: 'New goal' } })), /requires Commit/);
  const maintenance = await service.prepareSave(proposal({
    change_kind: 'maintenance_correction', project_target: { ...project().content, goal: 'Corrected goal' },
  }));
  assert.equal(maintenance.commit_change, null);
  assert.equal((await service.applyChangeSet(maintenance.id)).outcome, 'applied');
  const current = (await new ProjectRepository(vault).get(projectId))!;
  const onlyCommit = await service.prepareSave(proposal({
    base_project_revision: current.metadata.revision, project_target: current.content, commit: stage,
  }));
  assert.equal(onlyCommit.project_change, null);
  await service.applyChangeSet(onlyCommit.id);
  assert.equal((await new ProjectRepository(vault).get(projectId))!.metadata.revision, 2);
}));

test('enrich keeps ID, unions provenance, rejects stale revision and no-op', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await new CommitRepository(vault).create(commit());
  await new ExperienceRepository(vault).create(experience());
  const service = new ChangeSetService(vault);
  const enrichment = await service.prepareSave(proposal({
    base_commit_head: commitId,
    experiences: [{
      action: 'enrich', target_id: experienceId, base_revision: 1,
      target: { ...experience().content, evidence: 'Observed again', maturity: 'validated' },
    }],
  }));
  assert.equal(enrichment.experience_changes[0].id, experienceId);
  assert.equal((await service.applyChangeSet(enrichment.id)).outcome, 'applied');
  const updated = (await new ExperienceRepository(vault).get(experienceId))!;
  assert.equal(updated.metadata.revision, 2);
  assert.deepEqual(updated.metadata.source_commits, [commitId]);
  assert.equal(updated.metadata.created_at, experience().metadata.created_at);
  assert.equal(updated.content.maturity, 'validated');
  await assert.rejects(service.prepareSave(proposal({
    base_commit_head: commitId,
    experiences: [{ action: 'enrich', target_id: experienceId, base_revision: 1, target: updated.content }],
  })), /revision changed/);
  await assert.rejects(service.prepareSave(proposal({
    base_commit_head: commitId,
    experiences: [{ action: 'enrich', target_id: experienceId, base_revision: 2, target: updated.content }],
  })), /no-op/);
}));

test('enrich from another Project preserves both source Commits', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await new CommitRepository(vault).create(commit());
  await new ExperienceRepository(vault).create(experience());
  const secondProjectId = 'prj-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  const secondCommitId = 'cmt-ffffffffffffffffffffffffffffffff';
  await new ProjectRepository(vault).create(project({
    metadata: { ...project().metadata, id: secondProjectId },
    content: { ...project().content, name: 'Another Project' },
  }));
  await new CommitRepository(vault).create(commit({
    metadata: { ...commit().metadata, id: secondCommitId, project_id: secondProjectId },
  }));
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({
    project_id: secondProjectId, base_commit_head: secondCommitId,
    project_target: { ...project().content, name: 'Another Project' },
    experiences: [{
      action: 'enrich', target_id: experienceId, base_revision: 1,
      target: { ...experience().content, evidence: 'Worked in another project' },
      source_commits: [secondCommitId],
    }],
  }));
  await service.applyChangeSet(prepared.id);
  assert.deepEqual((await new ExperienceRepository(vault).get(experienceId))!.metadata.source_commits, [commitId, secondCommitId]);
}));

test('manual semantic edits are pending, while formatting edits preserve accepted revision', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  const file = vault.projectFile(projectId);
  await writeFile(file, (await readFile(file, 'utf8')).replace('## Goal', '##   Goal'));
  assert.equal((await projects.inspect(projectId))?.state, 'accepted');
  await writeFile(file, (await readFile(file, 'utf8')).replace('Reliable project memory', 'Different goal'));
  assert.equal((await projects.inspect(projectId))?.state, 'external_change_pending');
  await assert.rejects(new ChangeSetService(vault).prepareSave(proposal()), /external semantic edit/);
  assert.equal((await new MemoryService(vault).projectGet(projectId)).read_state, 'external_change_pending');
}));

test('Experience formatting edits preserve revision and machine timestamp edits fail integrity', async () => withVault(async (vault) => {
  await new ExperienceRepository(vault).create(experience());
  const experiences = new ExperienceRepository(vault);
  const file = vault.experienceFile(experienceId);
  await writeFile(file, (await readFile(file, 'utf8')).replace('## Core Statement', '##   Core Statement'));
  assert.equal((await experiences.inspect(experienceId))?.state, 'accepted');
  assert.equal((await experiences.get(experienceId))?.metadata.revision, 1);
  await writeFile(file, (await readFile(file, 'utf8')).replace(/^updated_at:.*$/m, 'updated_at: 2030-01-01T00:00:00.000Z'));
  await assert.rejects(experiences.inspect(experienceId), /Accepted update time changed/);
}));

test('Project revision changing after Prepare makes the older ChangeSet terminally conflicted', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  const service = new ChangeSetService(vault);
  const first = await service.prepareSave(proposal({
    change_kind: 'maintenance_correction', project_target: { ...project().content, name: 'First edit' },
  }));
  const second = await service.prepareSave(proposal({
    change_kind: 'maintenance_correction', project_target: { ...project().content, name: 'Second edit' },
  }));
  await service.applyChangeSet(first.id);
  assert.equal((await service.applyChangeSet(second.id)).outcome, 'conflicted');
  assert.equal((await new ChangeSetRepository(vault).get(second.id))?.status, 'conflicted');
  assert.equal((await new ProjectRepository(vault).get(projectId))?.content.name, 'First edit');
}));

test('stale Project or Commit head becomes terminal conflicted; reject leaves knowledge unchanged', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  const service = new ChangeSetService(vault);
  const first = await service.prepareSave(proposal({ commit: stage }));
  const second = await service.prepareSave(proposal({ commit: stage }));
  await service.applyChangeSet(first.id);
  const conflict = await service.applyChangeSet(second.id);
  assert.equal(conflict.outcome, 'conflicted');
  assert.equal((await new ChangeSetRepository(vault).get(second.id))?.status, 'conflicted');
  await assert.rejects(service.applyChangeSet(second.id), /conflicted/);
  const current = (await new ProjectRepository(vault).get(projectId))!;
  const rejectable = await service.prepareSave(proposal({
    base_commit_head: first.commit_change!.id, base_project_revision: current.metadata.revision,
    project_target: current.content, commit: stage,
  }));
  await service.rejectChangeSet(rejectable.id);
  assert.equal((await new CommitRepository(vault).list(projectId)).length, 1);
}));

test('transaction journal detects interruption and replays deterministic intended writes', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  const file = vault.projectFile(projectId);
  const before = await readFile(file, 'utf8');
  const after = before.replace('Designing v1', 'Built v1');
  const write = await plannedWrite(vault, file, after);
  await writeFile(vault.transactionFile(), JSON.stringify({ changeset_id: 'test', writes: [write] }));
  await assert.rejects(assertNoIncompleteTransaction(vault), /requires recovery/);
  assert.equal(await recoverTransaction(vault), true);
  assert.equal(await readFile(file, 'utf8'), after);
  assert.equal(await recoverTransaction(vault), false);
}));

test('partial multi-file transaction recovery completes remaining writes, and stale lock is reclaimed', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  const fileA = vault.projectFile(projectId);
  const fileB = vault.baselineFile('project', projectId);
  const a = await readFile(fileA, 'utf8');
  const b = await readFile(fileB, 'utf8');
  const nextA = a.replace('Designing v1', 'Recovered v1');
  const nextB = b.replace('"revision":1', '"revision":2');
  const writes = [await plannedWrite(vault, fileA, nextA), await plannedWrite(vault, fileB, nextB)];
  await writeFile(vault.transactionFile(), JSON.stringify({ changeset_id: 'interrupted', writes }));
  await writeFile(fileA, nextA);
  await writeFile(vault.writeLockFile(), JSON.stringify({ pid: 99999999, created_at: '2020-01-01T00:00:00Z' }));
  await withVaultWriteLock(vault, () => recoverTransaction(vault));
  assert.equal(await readFile(fileB, 'utf8'), nextB);
  assert.equal(await readFile(fileA, 'utf8'), nextA);
}));

test('minimal search finds Project and Experience, and empty result is valid', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await new CommitRepository(vault).create(commit());
  await new ExperienceRepository(vault).create(experience());
  const memory = new MemoryService(vault);
  assert.equal((await memory.search({ query: 'semantic interfaces' })).results[0].kind, 'experience');
  assert.equal((await memory.search({ query: 'not present' })).results.length, 0);
  assert.equal((await memory.search({ query: 'memory', kind: 'project' })).results[0].id, projectId);
}));

test('empty Vault can prepare and apply its first Project through confirmation boundary', async () => withVault(async (vault) => {
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({
    project_id: null, base_project_revision: 0, base_commit_head: null,
  }));
  assert.match(prepared.project_id, /^prj-[0-9a-f]{32}$/);
  assert.equal((await new ProjectRepository(vault).list()).length, 0);
  assert.equal((await service.applyChangeSet(prepared.id)).outcome, 'applied');
  assert.equal((await new ProjectRepository(vault).get(prepared.project_id))?.metadata.revision, 1);
}));

test('external Project and Experience edits can be adopted through Preview and Apply', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await new CommitRepository(vault).create(commit());
  await new ExperienceRepository(vault).create(experience());
  const projectFile = vault.projectFile(projectId);
  const experienceFile = vault.experienceFile(experienceId);
  await writeFile(projectFile, (await readFile(projectFile, 'utf8')).replace('Designing v1', 'Manually refined v1'));
  await writeFile(experienceFile, (await readFile(experienceFile, 'utf8')).replace('semantic APIs', 'structured APIs'));
  const projectTarget = { ...project().content, current_state: 'Manually refined v1' };
  const experienceTarget = { ...experience().content, core_statement: 'Agents should save through structured APIs' };
  const service = new ChangeSetService(vault);
  await assert.rejects(service.prepareSave(proposal({
    base_commit_head: commitId, project_target: projectTarget,
    experiences: [{ action: 'enrich', target_id: experienceId, base_revision: 1, target: experienceTarget }],
  })), /external semantic edit/);
  const prepared = await service.prepareSave(proposal({
    base_commit_head: commitId, change_kind: 'maintenance_correction',
    external_change: 'adopt', project_target: projectTarget,
    experiences: [{ action: 'enrich', target_id: experienceId, base_revision: 1, target: experienceTarget }],
  }));
  assert.ok(prepared.project_change);
  assert.equal((await service.applyChangeSet(prepared.id)).outcome, 'applied');
  assert.equal((await new ProjectRepository(vault).get(projectId))?.metadata.revision, 2);
  assert.equal((await new ExperienceRepository(vault).get(experienceId))?.metadata.revision, 2);
}));

test('Experience manual edit after prepare causes terminal conflict and Commit edit is integrity error', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await new CommitRepository(vault).create(commit());
  await new ExperienceRepository(vault).create(experience());
  const service = new ChangeSetService(vault);
  const prepared = await service.prepareSave(proposal({
    base_commit_head: commitId,
    experiences: [{ action: 'enrich', target_id: experienceId, base_revision: 1,
      target: { ...experience().content, evidence: 'New practice' } }],
  }));
  const file = vault.experienceFile(experienceId);
  await writeFile(file, (await readFile(file, 'utf8')).replace('semantic APIs', 'edited APIs'));
  assert.equal((await service.applyChangeSet(prepared.id)).outcome, 'conflicted');
  assert.equal((await new ChangeSetRepository(vault).get(prepared.id))?.status, 'conflicted');
  const commitFile = vault.commitFile(projectId, commitId);
  await writeFile(commitFile, (await readFile(commitFile, 'utf8')).replace('No durable memory', 'Changed history'));
  await assert.rejects(new CommitRepository(vault).get(projectId, commitId), /historical semantics changed/);
}));
