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
import { commit, experience, project, withVault } from './fixtures.js';

type Data = Record<string, any>;

async function withMcp<T>(vault: Vault, work: (client: Client) => Promise<T>): Promise<T> {
  const server = createMcpServer(new MemoryService(vault));
  const client = new Client({ name: 'personal-memory-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { return await work(client); }
  finally { await client.close(); await server.close(); }
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ data: Data; text: string; isError: boolean }> {
  const response = await client.callTool({ name, arguments: args });
  const content = Array.isArray(response.content) ? response.content as Array<{ type: string; text?: string }> : [];
  return {
    data: (response.structuredContent ?? {}) as Data,
    text: content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n'),
    isError: response.isError === true,
  };
}

test('MCP read flow exposes domain summaries, full documents, and historical Experience', async () => withVault(async (vault) => {
  await new ProjectRepository(vault).create(project());
  await new CommitRepository(vault).create(commit());
  const experiences = new ExperienceRepository(vault);
  await experiences.create(experience());
  await experiences.create(experience({ id: 'historical', lifecycle: 'merged', merged_into: 'semantic-interfaces' }));
  await withMcp(vault, async (client) => {
    const tools = (await client.listTools()).tools.map((item) => item.name);
    assert.ok(tools.includes('memory_project_list'));
    assert.ok(!tools.includes('memory_read_file'));
    const projectTool = (await client.listTools()).tools.find((item) => item.name === 'memory_project_get');
    assert.deepEqual(projectTool?.inputSchema.required, ['project_id']);
    assert.equal((await call(client, 'memory_project_list')).data.projects[0].id, 'personal-memory');
    assert.equal((await call(client, 'memory_project_get', { project_id: 'personal-memory' })).data.project.body, project().body);
    assert.equal((await call(client, 'memory_commit_list', { project_id: 'personal-memory' })).data.commits[0].title, 'Initial understanding');
    assert.equal((await call(client, 'memory_commit_get', { project_id: 'personal-memory', commit_id: 'pm-0001' })).data.commit.metadata.sequence, 1);
    assert.deepEqual((await call(client, 'memory_experience_list')).data.experiences.map((item: Data) => item.id), ['semantic-interfaces']);
    assert.deepEqual((await call(client, 'memory_experience_list', { lifecycle: 'merged' })).data.experiences.map((item: Data) => item.id), ['historical']);
    assert.deepEqual((await call(client, 'memory_experience_list', { status: 'candidate', project_id: 'personal-memory' })).data.experiences.map((item: Data) => item.id), ['semantic-interfaces']);
    assert.equal((await call(client, 'memory_experience_get', { experience_id: 'historical' })).data.experience.metadata.merged_into, 'semantic-interfaces');
    const missing = await call(client, 'memory_project_get', { project_id: 'missing' });
    assert.equal(missing.isError, true);
    assert.equal(missing.data.error.code, 'NOT_FOUND');
    const invalid = await call(client, 'memory_project_get', { project_id: '../escape' });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.data.error.code, 'INVALID_INPUT');
  });
}));

test('Project summaries sort by absolute updated time across timezone offsets', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project({ id: 'earlier', updated_at: '2026-09-24T20:00:00+08:00' }));
  await projects.create(project({ id: 'later', updated_at: '2026-09-24T13:00:00Z' }));
  await withMcp(vault, async (client) => {
    assert.deepEqual((await call(client, 'memory_project_list')).data.projects.map((item: Data) => item.id), ['later', 'earlier']);
  });
}));

test('MCP prepare, preview, apply flow keeps knowledge unchanged until separate apply call', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  await withMcp(vault, async (client) => {
    const prepared = await call(client, 'memory_prepare_save', {
      project_id: 'personal-memory', project_update: { status: 'paused' },
      commit: { title: 'MCP milestone', body: '## Stage Goal\nExpose tools.' },
      experience_changes: [{ action: 'create', title: 'Use an agent-facing tool', body: 'Useful conclusion.' }],
      ignored_items: [{ summary: 'Transient note', reason: 'Not reusable' }],
    });
    assert.equal(prepared.isError, false);
    assert.equal(prepared.data.status, 'pending_confirmation');
    assert.match(prepared.text, /Commit\n- MCP milestone/);
    assert.match(prepared.text, /Transient note: Not reusable/);
    assert.equal((await projects.get('personal-memory'))?.metadata.revision, 1);
    assert.deepEqual(await new ExperienceRepository(vault).list(), []);
    const id = prepared.data.changeset_id as string;
    const restored = await call(client, 'memory_changeset_get', { changeset_id: id });
    assert.equal(restored.data.status, 'pending');
    assert.equal(restored.data.preview.commit.title, 'MCP milestone');
    const applied = await call(client, 'memory_apply_changeset', { changeset_id: id });
    assert.equal(applied.data.status, 'applied');
    assert.equal((await projects.get('personal-memory'))?.metadata.status, 'paused');
    assert.equal((await new CommitRepository(vault).list('personal-memory')).length, 1);
    assert.equal((await new ExperienceRepository(vault).list()).length, 1);
    const again = await call(client, 'memory_apply_changeset', { changeset_id: id });
    assert.equal(again.data.error.code, 'INVALID_STATE');
  });
}));

test('MCP reject and conflict are mapped without hiding the domain outcome', async () => withVault(async (vault) => {
  const projects = new ProjectRepository(vault);
  await projects.create(project());
  await withMcp(vault, async (client) => {
    const args = { project_id: 'personal-memory', project_update: { status: 'paused' }, experience_changes: [], ignored_items: [] };
    const first = await call(client, 'memory_prepare_save', args);
    const rejected = await call(client, 'memory_reject_changeset', { changeset_id: first.data.changeset_id });
    assert.equal(rejected.data.status, 'rejected');
    assert.equal((await projects.get('personal-memory'))?.metadata.status, 'active');
    const blocked = await call(client, 'memory_apply_changeset', { changeset_id: first.data.changeset_id });
    assert.equal(blocked.data.error.code, 'INVALID_STATE');
    const second = await call(client, 'memory_prepare_save', args);
    await projects.update(project({ revision: 2, updated_at: '2026-09-25T00:00:00Z' }));
    const conflict = await call(client, 'memory_apply_changeset', { changeset_id: second.data.changeset_id });
    assert.equal(conflict.data.error.code, 'CONFLICT');
  });
}));

test('real stdio MCP client reaches the server process', async () => withVault(async (vault, root) => {
  await new ProjectRepository(vault).create(project());
  const executable = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/mcp/cli.js');
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const client = new Client({ name: 'stdio-smoke-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [executable], env: { ...env, PERSONAL_MEMORY_VAULT: root }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.equal((await call(client, 'memory_project_list')).data.projects[0].id, 'personal-memory');
    assert.equal((await call(client, 'memory_project_get', { project_id: 'personal-memory' })).data.project.metadata.name, 'Personal Memory');
  } finally { await client.close(); }
}));

test('server refuses an unknown Vault instead of initializing it', async () => withVault(async (_vault, root) => {
  const executable = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/mcp/cli.js');
  const result = spawnSync(process.execPath, [executable], { env: { ...process.env, PERSONAL_MEMORY_VAULT: path.join(root, 'unknown') }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid Personal Memory Vault/);
}));
