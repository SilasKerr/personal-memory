import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  changeSetSchema, commitMetadataSchema, experienceMetadataSchema, projectMetadataSchema,
  saveProposalSchema,
} from '../src/domain/schemas.js';
import { defaultCommitBody, defaultExperienceBody, defaultProjectBody } from '../src/domain/templates.js';
import { parseMarkdown, serializeMarkdown } from '../src/storage/markdown.js';
import { commit, experience, project } from './fixtures.js';

test('Project, Commit, and Experience Markdown round-trip preserves bodies exactly', () => {
  const projectDocument = project({}, '# Title\n\nText with --- and trailing spaces.  \n');
  const commitDocument = commit({}, '# Stage\n\nA | B\n\n');
  const experienceDocument = experience({}, '# Conclusion\n\n- one\n- two\n');
  assert.deepEqual(parseMarkdown(serializeMarkdown(projectDocument.metadata, projectDocument.body, projectMetadataSchema), projectMetadataSchema), projectDocument);
  assert.deepEqual(parseMarkdown(serializeMarkdown(commitDocument.metadata, commitDocument.body, commitMetadataSchema), commitMetadataSchema), commitDocument);
  assert.deepEqual(parseMarkdown(serializeMarkdown(experienceDocument.metadata, experienceDocument.body, experienceMetadataSchema), experienceMetadataSchema), experienceDocument);
});

test('default bodies contain the specified human-readable sections', () => {
  assert.match(defaultProjectBody('Personal Memory'), /^# Personal Memory\n\n## Goal/);
  assert.match(defaultProjectBody('Personal Memory'), /## Recent Changes/);
  assert.match(defaultCommitBody('Stage 1'), /## Rejected Approaches/);
  assert.match(defaultExperienceBody('Conclusion'), /## Applies When/);
});

test('Project metadata rejects invalid ID, status, revision, timestamp, and unknown fields', () => {
  const valid = project().metadata;
  for (const invalid of [
    { ...valid, id: '../escape' },
    { ...valid, status: 'draft' },
    { ...valid, revision: 0 },
    { ...valid, revision: 1.5 },
    { ...valid, created_at: 'yesterday' },
    { ...valid, extra: true },
  ]) assert.equal(projectMetadataSchema.safeParse(invalid).success, false);
});

test('Commit metadata validates sequence, project ID, and first/next predecessor', () => {
  const valid = commit().metadata;
  assert.equal(commitMetadataSchema.safeParse(valid).success, true);
  for (const invalid of [
    { ...valid, sequence: 0 },
    { ...valid, project_id: '../escape' },
    { ...valid, previous_commit: 'pm-0000' },
    { ...valid, sequence: 2, previous_commit: null },
  ]) assert.equal(commitMetadataSchema.safeParse(invalid).success, false);
});

test('Experience maturity, lifecycle, relations, and required targets validate', () => {
  const valid = experience().metadata;
  for (const status of ['candidate', 'validated', 'principle']) {
    assert.equal(experienceMetadataSchema.safeParse({ ...valid, status }).success, true);
  }
  assert.equal(experienceMetadataSchema.safeParse({ ...valid, lifecycle: 'merged', merged_into: 'combined' }).success, true);
  assert.equal(experienceMetadataSchema.safeParse({ ...valid, lifecycle: 'superseded', superseded_by: 'replacement' }).success, true);
  for (const invalid of [
    { ...valid, status: 'merged' },
    { ...valid, lifecycle: 'merged' },
    { ...valid, lifecycle: 'superseded' },
    { ...valid, source_projects: ['../escape'] },
  ]) assert.equal(experienceMetadataSchema.safeParse(invalid).success, false);
});

test('Markdown parser rejects malformed or duplicate frontmatter', () => {
  assert.throws(() => parseMarkdown('# no frontmatter\n', projectMetadataSchema));
  assert.throws(() => parseMarkdown('---\nid: one\nid: two\n---\n', projectMetadataSchema));
  assert.throws(() => parseMarkdown('---\nid: [broken\n---\n', projectMetadataSchema));
});

test('Markdown parse and serialize both enforce metadata schema', () => {
  const valid = project();
  assert.throws(() => serializeMarkdown({ ...valid.metadata, status: 'draft' }, valid.body, projectMetadataSchema));
  const source = serializeMarkdown(valid.metadata, valid.body, projectMetadataSchema);
  assert.throws(() => parseMarkdown(source.replace('status: active', 'status: draft'), projectMetadataSchema));
});

test('ChangeSet schema defines only the requested data shape', () => {
  const value = {
    id: 'change-1', status: 'pending', created_at: '2026-09-24T00:00:00Z',
    applied_at: null, rejected_at: null, project_id: 'personal-memory', base_project_revision: 1,
    base_commit_id: null, base_commit_sequence: 0,
    project_change: null, commit_change: null, experience_changes: [], ignored_items: [{ summary: 'irrelevant note', reason: 'temporary detail' }],
  };
  assert.equal(changeSetSchema.safeParse(value).success, true);
  assert.equal(changeSetSchema.safeParse({ ...value, status: 'pending_confirmation' }).success, false);
});

test('SaveProposal accepts semantic intent and rejects invalid merge or ignored item', () => {
  const valid = { project_id: 'personal-memory', experience_changes: [], ignored_items: [{ summary: 'Skip', reason: 'Temporary' }] };
  assert.equal(saveProposalSchema.safeParse(valid).success, true);
  assert.equal(saveProposalSchema.safeParse({ ...valid, revision: 3 }).success, false);
  assert.equal(saveProposalSchema.safeParse({ ...valid, ignored_items: ['Skip'] }).success, false);
  assert.equal(saveProposalSchema.safeParse({ ...valid, experience_changes: [{ action: 'merge', source_ids: ['one'], result: { title: 'Result', body: '' } }] }).success, false);
  assert.equal(saveProposalSchema.safeParse({ ...valid, experience_changes: [{ action: 'merge', source_ids: ['one', 'one'], result: { title: 'Result', body: '' } }] }).success, false);
});
