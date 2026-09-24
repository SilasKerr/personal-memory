# Personal Memory v1

Personal Memory is a local, Markdown-backed project knowledge tool called by a Host Agent. The Agent decides what a conversation means and proposes what to save. Personal Memory validates the proposal, freezes a ChangeSet, renders a preview, and applies **that same ChangeSet only after the Agent obtains explicit user confirmation**. It does not run another LLM or capture work proactively.

Project is the accepted current state, Commit is an immutable cognitive-stage record, and Experience is reusable current knowledge. Experience v1 supports **create and enrich only**.

## Clean install and setup

```sh
npm ci
npm run typecheck
npm test
npm run build
PERSONAL_MEMORY_VAULT=/absolute/path/to/vault npm run init-vault
```

`init-vault` creates `Projects/`, `Experiences/`, and the local `.memory/` bookkeeping directories. The MCP server requires an initialized Vault and refuses unknown directories. Paths must be absolute. Its stdio entry point is:

```sh
PERSONAL_MEMORY_VAULT=/absolute/path/to/vault node dist/src/mcp/cli.js
```

For an MCP client, invoke `node` directly with the absolute path to `dist/src/mcp/cli.js` and set `PERSONAL_MEMORY_VAULT`. Package-manager output must not enter stdio. The server instruction requires calling Agents to show the Preview and obtain confirmation before `memory_apply_changeset`.

## Tools

| Tool | Purpose |
| --- | --- |
| `memory_project_list` / `memory_project_get` | Find current Project summaries; read structured current state and any external-edit status. |
| `memory_commit_list` / `memory_commit_get` | Read sequence-ordered stage history. |
| `memory_experience_list` / `memory_experience_get` | Read reusable Experience summaries and full state. |
| `memory_search` | Normalized text search over accepted Projects and Experiences; optional kind and Project filter. |
| `memory_prepare_save` | Validate a structured proposal, freeze IDs and semantic targets, persist a pending ChangeSet, return Preview. |
| `memory_changeset_get` | Recover the status and same Preview after an interrupted Agent session. |
| `memory_apply_changeset` | Apply the pending ChangeSet after explicit confirmation; returns `applied`, `already_applied`, or `conflicted`. |
| `memory_reject_changeset` | Reject a pending ChangeSet without changing domain knowledge. |

No raw file write, generic CRUD, `prepare_and_apply`, merge, supersede, archive, or abstract tool is exposed.

## First Project

Use `memory_prepare_save` with `project_id: null`, `base_project_revision: 0`, `base_commit_head: null`, a complete `project_target`, and empty `experiences`. Prepare generates an opaque Project ID and shows the full target. After user confirmation, Apply writes the Project. An initial Commit is optional because this is creation, not a change to an already accepted Project.

For an existing Project, first read it and the Commit head. A proposal supplies its ID, base revision, base Commit head, `change_kind`, a **complete** Project target state, optional structured Commit, and Experience create/enrich proposals. Historically significant Project changes require a Commit unless `change_kind: maintenance_correction` is explicitly presented and confirmed. Creating only a Commit leaves Project revision unchanged.

An Experience enrich supplies `target_id`, `base_revision`, and the complete target semantic state. It keeps the same ID and unions source Commit references. If the same ChangeSet creates a Commit, Memory adds that new Commit to the Experience provenance. IDs and accepted timestamps are system-managed; Apply does not regenerate semantics or IDs.

See [the v1 schema](src/domain/schemas.ts) and [the confirmed contracts](docs/) for exact fields.

## Manual Obsidian edits

Project and Experience Markdown is human-readable and is parsed back into structured state. Memory stores a small accepted baseline with identity, revision, system timestamps, provenance where applicable, and a semantic fingerprint. Whitespace-only formatting changes do not increment revision. External semantic edits return `external_change_pending` on full get and are excluded from ordinary trusted search and writes.

The same `memory_prepare_save → Preview → confirmation → Apply` flow can accept an external edit. Set `external_change` to `adopt` when the complete target matches the edited content, or `reconcile` when the target is the desired corrected content. Historical Project changes still require the usual Commit or explicit maintenance-correction exception. This is not an automatic background workflow. Commit historical semantic edits are integrity errors and cannot be adopted as ordinary history.

## Conflicts and recovery

Prepare does not write formal knowledge. Apply acquires a local write lock and checks Project revision and fingerprint, Commit head, Experience revision and fingerprint, external-edit state, and generated ID collisions before any domain file write. A changed baseline makes the ChangeSet terminally `conflicted`; it must be prepared again. A second Apply of a successful ChangeSet returns `already_applied` without writing again.

Apply records a small file-write intent journal before its first domain write, then publishes canonical Markdown, baselines, and final ChangeSet status. On MCP startup an incomplete journal is replayed deterministically. If a file differs from both its previous and intended contents, startup reports an integrity error and ordinary writes stay blocked. A lock left by a dead local process can be reclaimed; a live or unreadable lock is not silently removed. This is local crash recovery, not a distributed transaction system.

Search is a simple normalized filesystem scan, with no vectors or embeddings. List tools return summaries; full reads are explicit.

## Repository contracts

- [Final Project Requirements](docs/personal-memory-v1-final-project-requirements.md)
- [Project Domain Contract](docs/project-domain-contract-v1.md)
- [Commit Domain Contract](docs/commit-domain-contract-v1.md)
- [Experience Domain Contract](docs/experience-domain-contract-v1.md)
- [Implementation Gap Analysis](docs/personal-memory-v1-implementation-gap-analysis.md)

The Gap Analysis describes the experimental code before this convergence pass. The contracts and final requirements define v1 behavior.

## Known limits

- The old experimental Vault format is not migrated automatically. A Vault without accepted baselines or with old domain fields requires an explicit migration before this server can trust it.
- Experience v1 retains current accepted content and provenance, but does not store every previous full revision body.
- All cooperating writers must use the Vault lock. Direct external edits during an active Apply can produce an integrity stop requiring review.
