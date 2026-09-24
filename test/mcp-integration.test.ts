import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { test } from 'node:test';
import { CommitRepository } from '../src/repositories/commit-repository.js';
import { ExperienceRepository } from '../src/repositories/experience-repository.js';
import { ProjectRepository } from '../src/repositories/project-repository.js';
import { createMcpServer } from '../src/mcp/server.js';
import { MemoryService } from '../src/services/memory-service.js';
import { Vault } from '../src/storage/vault.js';
import { commit, commitId, experience, project, projectId, withVault } from './fixtures.js';

type Data = Record<string, any>;
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Data> {
  const response = await client.callTool({ name, arguments: args });
  return { ...response.structuredContent as Data, isError: response.isError === true };
}
async function withMcp(vault: Vault, work: (client: Client) => Promise<void>): Promise<void> {
  const server = createMcpServer(new MemoryService(vault));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try { await work(client); }
  finally { await client.close(); await server.close(); }
}

test('MCP exposes narrowed tools and full prepare, preview, apply flow', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await withMcp(vault, async (client) => {
    const names = (await client.listTools()).tools.map((item) => item.name);
    assert.ok(names.includes('memory_search'));
    assert.ok(!names.includes('memory_write_file'));
    assert.equal((await call(client, 'memory_project_get', { project_id: projectId })).project.content.goal, 'Reliable project memory');
    const prepared = await call(client, 'memory_prepare_save', {
      project_id: projectId, base_project_revision: 1, base_commit_head: null,
      change_kind: 'historical_change',
      project_target: { ...project().content, current_state: 'MCP ready' },
      commit: { content: {
        title: 'MCP ready', starting_point: 'No interface', key_findings: ['Tools are available'], ending_state: 'Usable interface',
      } },
      experiences: [{ action: 'create', target: {
        title: 'Use a stable preview', core_statement: 'Review the exact ChangeSet before Apply', maturity: 'candidate',
      } }],
    });
    assert.equal(prepared.isError, false);
    assert.equal((await new ProjectRepository(vault).get(projectId))?.metadata.revision, 1);
    const retrieved = await call(client, 'memory_changeset_get', { changeset_id: prepared.changeset_id });
    assert.equal(retrieved.preview.commit.id, prepared.preview.commit.id);
    assert.equal((await call(client, 'memory_apply_changeset', { changeset_id: prepared.changeset_id })).status, 'applied');
    assert.equal((await call(client, 'memory_apply_changeset', { changeset_id: prepared.changeset_id })).status, 'already_applied');
    assert.equal((await call(client, 'memory_search', { query: 'stable preview' })).results[0].kind, 'experience');
    assert.equal((await new CommitRepository(vault).list(projectId)).length, 1);
    assert.equal((await new ExperienceRepository(vault).list()).length, 1);
  });
}));

test('real stdio MCP process serves a clean Vault and rejects unknown Vault', async () => withVault(async (vault, root) => {
  await new ProjectRepository(vault).create(project());
  await new CommitRepository(vault).create(commit());
  await new ExperienceRepository(vault).create(experience());
  const executable = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/mcp/cli.js');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const client = new Client({ name: 'stdio-smoke', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath, args: [executable], env: { ...env, PERSONAL_MEMORY_VAULT: root }, stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    assert.equal((await call(client, 'memory_project_list')).projects[0].id, projectId);
    assert.equal((await call(client, 'memory_commit_get', { project_id: projectId, commit_id: commitId })).commit.content.title, 'Initial understanding');
    assert.equal((await call(client, 'memory_experience_list')).experiences[0].id, experience().metadata.id);
  } finally { await client.close(); }
  const bad = spawnSync(process.execPath, [executable], {
    env: { ...process.env, PERSONAL_MEMORY_VAULT: path.join(root, 'unknown') }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Invalid Personal Memory Vault/);
}));
