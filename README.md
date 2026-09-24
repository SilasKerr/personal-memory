# Personal Memory v1 — Minimal MCP interface

Personal Memory is a local, Markdown-backed project knowledge tool for Agents. The Obsidian Vault is the canonical knowledge store. The MCP server exposes domain operations over stdio; it does not expose file editing, search, or an LLM.

## Install and test

```sh
npm ci
npm run typecheck
npm test
npm run build
```

## Start the MCP server

Set `PERSONAL_MEMORY_VAULT` to the **absolute path of an initialized Personal Memory Vault**. An initialized Vault has `Projects/`, `Experiences/`, `.memory/changesets/`, and `.memory/config.yaml` containing `version: 1`. The server validates this structure at startup and refuses missing or invalid directories. It does not initialize an unknown directory.

```sh
PERSONAL_MEMORY_VAULT=/absolute/path/to/Personal\ Memory node /absolute/path/to/personal-memory/dist/src/mcp/cli.js
```

`npm run mcp` also starts the compiled entry point after `npm run build`. For MCP clients, launch `node` directly so package-manager status text cannot enter the stdio protocol stream. The package declares a `personal-memory-mcp` binary for installations that link package bins.

A generic Agent MCP configuration looks like this; adapt the outer configuration key to your Agent:

```json
{
  "mcpServers": {
    "personal-memory": {
      "command": "node",
      "args": ["/absolute/path/to/personal-memory/dist/src/mcp/cli.js"],
      "env": {
        "PERSONAL_MEMORY_VAULT": "/absolute/path/to/Personal Memory"
      }
    }
  }
}
```

**Calling agents MUST present the Memory Commit Preview to the user and obtain confirmation before invoking `memory_apply_changeset`.** `memory_prepare_save` and `memory_apply_changeset` are separate tools. Prepare never applies automatically. The MCP server has no UI and cannot determine whether a user has confirmed; the calling Agent owns that step.

## Tools

All tools return structured MCP content plus readable text. Errors return `isError: true`, a readable message, and `structuredContent.error` with `code` and `message`.

| Tool | Input | Structured output |
| --- | --- | --- |
| `memory_project_list` | `{}` | `{projects: [{id, name, status, updated_at, latest_commit}]}` sorted by `updated_at` descending |
| `memory_project_get` | `{project_id}` | `{project: {metadata, body}}` |
| `memory_commit_list` | `{project_id}` | `{commits: [{id, sequence, created_at, title}]}` sorted by sequence |
| `memory_commit_get` | `{project_id, commit_id}` | `{commit: {metadata, body}}` |
| `memory_experience_list` | optional `{status, lifecycle, project_id}` | `{experiences: [{id, title, status, lifecycle, updated_at, source_projects}]}`; lifecycle defaults to `active` |
| `memory_experience_get` | `{experience_id}` | `{experience: {metadata, body}}`, including historical relations |
| `memory_prepare_save` | `SaveProposal` | `{status: "pending_confirmation", changeset_id, preview}` |
| `memory_changeset_get` | `{changeset_id}` | `{changeset_id, status, created_at, preview}` |
| `memory_apply_changeset` | `{changeset_id}` | `{status: "applied", changeset_id, project_id}` |
| `memory_reject_changeset` | `{changeset_id}` | `{status: "rejected", changeset_id}` |

`SaveProposal` contains `project_id`, optional `project_update` and `commit`, and arrays `experience_changes` and `ignored_items`. The Experience operations are `create`, `enrich`, `supersede`, and `merge`. Each ignored item contains `summary` and `reason`. See [the Zod schemas](src/domain/schemas.ts) for exact fields.

The preview is derived from the pending ChangeSet. It includes Project fields and revised body where applicable, the new Commit title and body, Experience create/update actions with their semantic purpose, and ignored items with reasons. `memory_changeset_get` lets an Agent recover this review after an interrupted session.

Error codes are `INVALID_INPUT`, `NOT_FOUND`, `ALREADY_EXISTS`, `CONFLICT`, `LOCKED`, `INVALID_STATE`, and `VAULT_ERROR`. Internal stacks are not sent to MCP callers. Unexpected Vault errors are logged to the local server's stderr.

## Code layout

```text
src/domain/         Project, Commit, Experience, SaveProposal, ChangeSet schemas
src/storage/        Markdown conversion, Vault paths, atomic writes, write lock
src/repositories/   Markdown and ChangeSet persistence
src/services/       MemoryService reads, ChangeSet lifecycle, preview
src/mcp/            stdio entry point, tool definitions, error mapping
test/               schema, repository, lifecycle, MCP, and stdio tests
```

The MCP layer validates arguments and formats responses; MemoryService and ChangeSetService own the behavior. Project bodies remain opaque Markdown, so there is no `memory_project_resume` tool. There is no raw file API.

## Known limits

- Individual knowledge files are published atomically, but v1 does not guarantee cross-file atomicity after a sudden crash or power loss. A stale `.memory/write.lock` after a crash requires manual recovery.
- All cooperating writers must honor the Vault lock. External edits or direct Repository writes during apply can race with preflight.
- Experience relation targets beyond explicitly read operation targets are not fully checked here.
- There is no text or semantic search, HTTP transport, background agent, or automatic memory decision.
