import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { idSchema, saveProposalSchema } from '../domain/schemas.js';
import { MemoryService } from '../services/memory-service.js';
import { type MemoryCommitPreview } from '../services/preview.js';
import { mapError } from './errors.js';

const projectIdInput = z.strictObject({ project_id: idSchema });
const commitIdInput = z.strictObject({ project_id: idSchema, commit_id: idSchema });
const experienceIdInput = z.strictObject({ experience_id: idSchema });
const changesetIdInput = z.strictObject({ changeset_id: idSchema });
const experienceFilterInput = z.strictObject({
  status: z.enum(['candidate', 'validated', 'principle']).optional(),
  lifecycle: z.enum(['active', 'merged', 'superseded']).optional(),
  project_id: idSchema.optional(),
});

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
  execute: (args: unknown) => Promise<ToolResult>;
};

function defineTool<T>(name: string, description: string, schema: z.ZodType<T>, run: (input: T) => Promise<ToolResult>): ToolDefinition {
  return {
    name, description,
    inputSchema: z.toJSONSchema(schema) as Tool['inputSchema'],
    execute: (args) => run(schema.parse(args)),
  };
}

function result(value: object, text: string): ToolResult {
  return { content: [{ type: 'text', text }], structuredContent: value as Record<string, unknown> };
}

async function handled(work: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await work();
  } catch (error) {
    const mapped = mapError(error);
    if (mapped.code === 'VAULT_ERROR') console.error(error);
    return { isError: true, content: [{ type: 'text', text: `${mapped.code}: ${mapped.message}` }], structuredContent: { error: mapped } };
  }
}

export function createMcpServer(memory: MemoryService): Server {
  const server = new Server({ name: 'personal-memory', version: '0.1.0' }, {
    capabilities: { tools: {} },
    instructions: 'Calling agents MUST present the Memory Commit Preview to the user and obtain confirmation before invoking memory_apply_changeset.',
  });
  const tools: ToolDefinition[] = [
    defineTool('memory_project_list', 'List Project summaries, newest first.', z.strictObject({}),
      async () => {
        const data = await memory.projectList();
        return result(data, data.projects.map((item) => `${item.name} (${item.id}) — ${item.status}`).join('\n') || 'No Projects.');
      }),
    defineTool('memory_project_get', 'Read a Project and its complete Markdown body.', projectIdInput,
      async ({ project_id }) => {
        const data = await memory.projectGet(project_id);
        return result(data, `${data.project.metadata.name}\n\n${data.project.body}`);
      }),
    defineTool('memory_commit_list', 'List a Project Commit timeline without full bodies.', projectIdInput,
      async ({ project_id }) => {
        const data = await memory.commitList(project_id);
        return result(data, data.commits.map((item) => `${item.sequence}. ${item.title} (${item.id})`).join('\n') || 'No Commits.');
      }),
    defineTool('memory_commit_get', 'Read a complete Commit.', commitIdInput,
      async ({ project_id, commit_id }) => {
        const data = await memory.commitGet(project_id, commit_id);
        return result(data, data.commit.body);
      }),
    defineTool('memory_experience_list', 'List Experience summaries with optional metadata filters. Defaults to active lifecycle.', experienceFilterInput,
      async (filters) => {
        const data = await memory.experienceList(filters);
        return result(data, data.experiences.map((item) => `${item.title} (${item.id}) — ${item.status}, ${item.lifecycle}`).join('\n') || 'No matching Experiences.');
      }),
    defineTool('memory_experience_get', 'Read a complete Experience, including historical relations.', experienceIdInput,
      async ({ experience_id }) => {
        const data = await memory.experienceGet(experience_id);
        return result(data, data.experience.body);
      }),
    defineTool('memory_prepare_save', 'Prepare a SaveProposal and return a preview. Does not apply changes.', saveProposalSchema,
      async (proposal) => {
        const data = await memory.prepareSave(proposal);
        return result(data, formatPreview(data.preview));
      }),
    defineTool('memory_changeset_get', 'Get ChangeSet status and reviewable preview.', changesetIdInput,
      async ({ changeset_id }) => {
        const data = await memory.changesetGet(changeset_id);
        return result(data, `ChangeSet ${data.changeset_id}: ${data.status}\n\n${formatPreview(data.preview)}`);
      }),
    defineTool('memory_apply_changeset', 'Apply a pending ChangeSet after the calling Agent has obtained user confirmation.', changesetIdInput,
      async ({ changeset_id }) => {
        const data = await memory.applyChangeSet(changeset_id);
        return result(data, `Applied ChangeSet ${data.changeset_id} to Project ${data.project_id}.`);
      }),
    defineTool('memory_reject_changeset', 'Reject a pending ChangeSet without changing knowledge.', changesetIdInput,
      async ({ changeset_id }) => {
        const data = await memory.rejectChangeSet(changeset_id);
        return result(data, `Rejected ChangeSet ${data.changeset_id}.`);
      }),
  ];
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => handled(async () => {
    const tool = byName.get(request.params.name);
    if (!tool) throw new Error(`Unknown tool: ${request.params.name}`);
    return tool.execute(request.params.arguments ?? {});
  }));
  return server;
}

export function formatPreview(preview: MemoryCommitPreview): string {
  const lines = [`Memory Commit Preview — ${preview.changeset_id}`];
  lines.push('\nProject');
  if (preview.project) {
    lines.push(`- ${preview.project.id}: ${preview.project.changed_fields.join(', ')} (revision ${preview.project.next_revision})`);
    if (preview.project.body !== null) lines.push(preview.project.body);
  } else lines.push('- No Project update');
  lines.push('\nCommit');
  if (preview.commit) lines.push(`- ${preview.commit.title} (${preview.commit.id})\n${preview.commit.body}`);
  else lines.push('- No new Commit');
  lines.push('\nExperience');
  if (preview.experiences.length) for (const item of preview.experiences) lines.push(`- ${item.purpose} / ${item.action}: ${item.title} (${item.id})\n${item.body}`);
  else lines.push('- No Experience changes');
  lines.push('\nIgnored');
  if (preview.ignored_items.length) for (const item of preview.ignored_items) lines.push(`- ${item.summary}: ${item.reason}`);
  else lines.push('- Nothing ignored');
  return lines.join('\n');
}
