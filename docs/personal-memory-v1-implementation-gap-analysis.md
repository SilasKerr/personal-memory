# Personal Memory v1 — Implementation Gap Analysis

**Status:** Pre-convergence historical analysis. It records gaps in the experimental repository before the v1 implementation and does not describe the current code state.

**Basis:** latest uploaded repository snapshot + frozen v1 direction from the current design discussion.

## Executive summary

The existing repository is a useful experimental skeleton and should **not** be rewritten from zero.

Keep:
- TypeScript/Zod project structure
- Vault abstraction and path-safety checks
- Markdown/YAML parser/serializer infrastructure
- Repository separation
- MCP stdio server skeleton
- MemoryService / ChangeSetService separation
- persisted pending ChangeSets
- deterministic Preview generation pattern
- local write lock
- per-file atomic create/replace
- Project / Commit / Experience read APIs
- Commit linear sequence checks
- basic revision/head preflight structure

Rewrite or significantly refactor:
- domain schemas
- SaveProposal
- ChangeSet schema/lifecycle
- ChangeSetService.prepareSave
- ChangeSetService.applyChangeSet
- Project/Commit/Experience Markdown mapping
- manual-edit accepted-baseline handling
- MCP schemas/responses affected by new domain model
- tests and README

Add:
- accepted content fingerprint/baseline handling
- conflicted ChangeSet state
- apply idempotency behavior
- minimal search
- crash/incomplete-transaction detection or equivalent recovery marker
- final contract docs committed to Git

---

# 1. Repository/documentation gaps — P0

## Current

`docs/` is untracked.

Latest archive contains:
- `docs/commit-domain-contract-v1.md`
- `docs/experience-domain-contract-v1.md`

The confirmed Project Contract is missing from this repository snapshot.

## Required

Before implementation is considered reproducible:
- add confirmed Project Contract
- replace/revise Experience contract to final narrowed v1
- add final SaveProposal / ChangeSet requirements or implementation spec
- add Final Project Requirements
- commit all docs to Git

The repository must be sufficient for a fresh Codex session to recover the product rules without relying on chat history.

---

# 2. Dependency/reproducibility gap — P0

## Current

The uploaded `node_modules` contains a broken local absolute symlink for `@types/node`.

`npm run typecheck` currently fails with:

`TS2688: Cannot find type definition file for 'node'.`

## Required

Do not depend on archived `node_modules`.

Validate from a clean dependency install:

```sh
rm -rf node_modules dist
npm ci
npm run typecheck
npm test
```

`node_modules` remains ignored by Git.

---

# 3. Project domain — P0 major rewrite

## Current

`ProjectMetadata` currently stores:

- `id`
- `name`
- `status`
- `revision`
- `created_at`
- `updated_at`
- `latest_commit`

Project semantic content is one opaque Markdown `body`.

SaveProposal applies partial `project_update`.

Creating a Commit automatically changes `latest_commit` and therefore increments Project revision.

## Required

Project must represent the confirmed current-state contract.

Semantic fields must be first-class structured state:

- `name`
- `goal`
- `current_state`
- `confirmed_decisions`
- `open_questions`
- `next_steps`
- `lifecycle`

Machine fields:

- opaque immutable `id`
- `revision`
- `created_at`
- `updated_at`

Remove persisted:
- `latest_commit`
- duplicate derived relationship fields

Rename old `status` concept to confirmed `lifecycle`.

Project updates use a **complete target state**, not partial patch input.

Creating a Commit while Project state is unchanged must **not** increase Project revision.

Repository/rendering must serialize the structured Project semantics into canonical human-readable Markdown.

---

# 4. Project IDs — P0

## Current

The schema only restricts IDs to lowercase letters/digits/hyphens, but current fixtures and flows use semantic IDs such as:

`personal-memory`

## Required

New IDs must be system-generated opaque identities.

Names/titles/paths must not determine IDs.

Storage-safe encoding can remain lowercase/hyphen compatible if desired, but generated identity must be opaque.

Existing migration strategy can be handled separately if real user data already exists; do not weaken the new contract to preserve semantic IDs.

---

# 5. Project accepted baseline / manual edit handling — P0 missing

## Current

Repository reads Markdown directly as accepted state.

There is no accepted-content fingerprint.

External semantic edits become ordinary state immediately.

Prepare only checks revision; Apply only checks revision.

## Required

Implement the confirmed accepted-baseline concept.

At minimum track for mutable canonical content:

- object identity
- accepted revision
- normalized semantic-content fingerprint

For Project reads:
- formatting-only external changes → normal read
- semantic external changes → `external_change_pending`
- normal prepare/apply must stop until adopt/reconcile
- immutable identity/timestamp damage → integrity error
- missing/damaged baseline → explicit recovery path, no guessing

Exact storage layout is implementation-level.

---

# 6. Commit domain — P0 major rewrite

## Current

Commit metadata stores:

- semantic ID derived as `<project>-<sequence>`
- `previous_commit`
- `created_at` generated during Prepare

Commit body is opaque Markdown.

There is no structured:
- cognitive-stage content validation
- `experience_changes`
- cognition revision relation (`revises_commit_ids`)

## Required

Commit:

- opaque system-generated ID
- `project_id`
- continuous `sequence`
- Apply-time `created_at`
- no persisted `previous_commit_id`

Sequence is the single authoritative ordering fact.

Commit semantic content must follow the confirmed structured sparse narrative:
- title
- starting_point
- ending_state
- optional stage_goal
- key_findings
- turning_points
- decisions
- rejected_approaches
- open_questions
- next_steps
- optional cognition revision refs as finalized

Commit must also record the Experience operations that happened in the same stage, according to the frozen v1 scope (`create`, `enrich`).

Old Commit semantic content remains immutable.

---

# 7. Commit repository — P1 partial keep

## Keep

Current repository already:
- has no update API
- enforces linear sequence
- sorts by sequence
- detects gaps/inconsistent stored history

## Change

Remove dependence on persisted predecessor.

Validation becomes:

`sequence === latest.sequence + 1`

with no predecessor field.

Commit IDs become opaque.

Commit Markdown becomes canonical rendering of structured semantic fields.

---

# 8. Experience domain — P0 major rewrite

## Current

Experience metadata includes:

- `status`
- `lifecycle`
- `source_projects`
- `source_commits`
- supersede relations
- merge relations
- abstract relations
- tags

Body is opaque Markdown.

Current implementation supports:
- create
- enrich
- supersede
- merge

Experience ID is generated from title slug.

## Required v1

Executable operations only:

- `create`
- `enrich`

Minimal state:

- opaque immutable `id`
- `title`
- `core_statement`
- optional `context`
- optional `evidence`
- optional `applies_when`
- optional `limitations`
- optional `recommended_action`
- `maturity`: candidate / validated / principle
- `source_commits`
- `revision`
- `created_at`
- `updated_at`

Remove from v1:
- lifecycle
- source_projects as stored authority
- merge/supersede fields
- abstract fields
- tags unless independently re-approved
- full historical revision snapshots

Project provenance derives from source Commit ownership.

Enrich:
- same ID
- Host Agent supplies base revision
- complete target semantic state
- exact revision +1
- preserve created_at
- update updated_at
- union provenance
- semantic no-op does not create revision

---

# 9. Experience IDs — P0

## Current

`allocateExperienceId()` slugifies the title and adds `-2`, `-3`, etc.

## Required

Delete title-based identity allocation.

Use system-generated opaque IDs.

Title changes must never change identity.

---

# 10. Experience accepted baseline / manual edit handling — P0 missing

Same requirement as Project for mutable semantic content:

- accepted revision + semantic fingerprint
- semantic external edit → `external_change_pending`
- enrich must not silently overwrite external edit
- adopt/reconcile path updates accepted state/revision
- formatting-only changes do not increment revision

---

# 11. SaveProposal — P0 rewrite

## Current

Current shape:

- `project_id`
- optional partial `project_update`
- optional `{title, body}` Commit
- Experience actions create/enrich/supersede/merge
- ignored items

It does not bind:
- base Project revision supplied by Host Agent
- base Commit head
- Experience target base revision from Host Agent
- `change_kind`

## Required narrowed v1

Project-scoped structured input containing conceptually:

- `project_id`
- `base_project_revision`
- `base_commit_head`
- `change_kind`
  - historical_change
  - maintenance_correction
- complete `project_target`
- optional structured `commit`
- Experience proposals:
  - create
  - enrich
- optional ignored items

For enrich:
- `target_experience_id`
- `base_revision`
- complete target semantic state

Host Agent must not provide:
- generated IDs
- revisions/results
- timestamps
- derived relation metadata

Memory must not reinterpret create vs enrich.

---

# 12. Project/Commit consistency rule — P0 missing

## Required

When any historically significant Project field changes:

- `goal`
- `current_state`
- `confirmed_decisions`
- `open_questions`
- `next_steps`
- `lifecycle`

the same ChangeSet must contain a Commit unless the explicitly declared and reviewed `maintenance_correction` exception applies.

Memory validates this structurally.

It does not semantically decide whether text "deserves" history.

---

# 13. ChangeSet schema/lifecycle — P0 rewrite

## Current

States:
- pending
- applied
- rejected

Conflict is thrown as an error but the persisted ChangeSet remains `pending`.

## Required

States:
- pending
- applied
- rejected
- conflicted

Allowed terminal transitions only:

`pending → applied | rejected | conflicted`

A conflict must persist the ChangeSet as `conflicted`.

It cannot be retried/reopened.

A new read + Proposal + ChangeSet is required.

---

# 14. ChangeSet stable identity/content — P0 partial keep

## Keep

Current code:
- generates a ChangeSet ID
- persists pending ChangeSet
- Preview is derived from persisted ChangeSet

This is the correct architecture.

## Change

Prepare must freeze:
- opaque new Commit ID
- opaque new Experience IDs
- final semantic target states
- expected resulting revisions
- resolved provenance
- base fingerprints
- base Commit head

Apply cannot recompute them.

---

# 15. Timestamps — P0

## Current

Prepare sets:
- Commit `created_at`
- Experience create timestamps
- Project/Experience update timestamps

## Required

Formal accepted timestamps are Apply-time machine metadata.

Prepare freezes semantics and IDs.

Apply supplies system acceptance timestamps without changing confirmed semantics.

Do not display Prepare time as final object creation/update time.

---

# 16. Content fingerprints — P0 missing

## Current

Preflight checks revisions and head only.

## Required

ChangeSet binds:
- Project accepted semantic fingerprint
- every mutable target Experience accepted semantic fingerprint

Apply rechecks both revision and fingerprint.

This catches direct Obsidian edits that did not change revision.

---

# 17. ChangeSet conflict behavior — P0

## Current

Conflict throws `ConflictError`.

Persisted state remains pending.

## Required

Under the write lock:
- run full preflight
- if any baseline mismatch exists
- perform no domain writes
- persist ChangeSet as `conflicted`
- return conflict outcome

No auto rebase, auto merge, sequence renumbering, or target recomputation.

---

# 18. Apply idempotency — P0

## Current

Calling apply on an already applied ChangeSet raises generic `INVALID_STATE`.

## Required

Calling apply again on an applied ChangeSet must not duplicate domain changes.

Prefer explicit stable outcome:

`already_applied`

Rejected/conflicted ChangeSets remain non-applicable.

---

# 19. Cross-file transaction/crash behavior — P0/P1

## Current

Apply writes sequentially:

1. Commit
2. Experiences
3. Project
4. ChangeSet status

Each individual file publication is atomic.

But a crash between files can leave a partial domain write.

README explicitly acknowledges no cross-file atomicity and manual stale-lock recovery.

## Required for final v1

Keep the simple local model, but add enough transaction/recovery support that a partially interrupted Apply is detectable.

Minimum acceptable direction:
- full preflight first
- write lock
- transaction/recovery marker or small journal before first domain write
- deterministic knowledge of intended writes
- mark completion only after all domain files are committed
- on startup/next write, detect unfinished transaction
- block ordinary writes until deterministic recovery/repair completes

Do not build a database/distributed transaction system.

The precise mechanism is implementation design, not a new domain model.

---

# 20. Stale write lock recovery — P1

## Current

Crash can leave `.memory/write.lock` permanently.

## Required

Implement a safe local stale-lock strategy or transaction recovery that can distinguish live lock vs abandoned state.

Do not silently delete arbitrary active locks.

---

# 21. Preview — P1 refactor

## Keep

The current deterministic Preview pattern is correct.

## Change

Preview must use new domain concepts:
- Project structured diff/target
- `lifecycle` rather than old `status`
- no stored `latest_commit`
- structured Commit narrative
- Experience create/enrich only
- Experience maturity
- ignored items

No LLM or semantic rewrite in Preview.

---

# 22. Markdown renderer — P0/P1 rewrite

## Current

Repositories serialize arbitrary `body` strings provided upstream.

Templates are optional.

## Required

Final persistent Markdown must be rendered by Personal Memory from structured semantic state.

Host Agent should not control final Markdown formatting.

Implement canonical render/parse mapping for:
- Project
- Commit
- Experience

Metadata remains machine-focused.

Human-readable sections should omit empty optional sections instead of writing N/A placeholders.

Markdown remains the human-readable canonical content source.

---

# 23. Search — P1 missing

## Current

There is list/filter but no text search.

README explicitly says search is absent.

## Required v1

Add a minimal high-precision search API.

Do not add vector/embedding infrastructure.

A simple implementation is sufficient:
- normalized text search / filesystem scan, or
- SQLite FTS5 if already justified by implementation simplicity

Domain/API should not bind permanently to one engine.

Search should support finding relevant Experiences and optionally Project scope.

Empty results are valid.

---

# 24. MCP layer — P1 refactor, not rewrite

## Keep

- stdio server
- separate prepare/apply tools
- no raw file API
- structured errors
- server instruction requiring user confirmation
- read tools

## Change

Schemas and responses must follow new domain model.

Remove:
- Experience lifecycle filter
- supersede/merge SaveProposal inputs
- latest_commit from Project summaries

Add:
- minimal search tool

Potential Project creation/init flow should only be added if required by the final product setup; do not expand scope casually.

---

# 25. Read/retrieval token discipline — P1

Current:
- Project get returns full body
- Commit list is summary-first
- Experience list is summary-first

This is partly aligned.

Retain:
- list summaries first
- explicit full get operations

Refactor summaries to new structured fields.

Avoid automatically returning full history or all Experiences.

---

# 26. Tests — P0 major rewrite

A large portion of existing tests encode the old domain contract.

Delete/replace tests asserting:
- semantic slug IDs
- `latest_commit`
- `previous_commit`
- Experience lifecycle
- merge/supersede behavior
- source_projects
- old partial project_update
- Prepare-time creation timestamps

Keep/adapt tests for:
- path traversal and symlink safety
- Markdown malformed frontmatter
- repository create/read/update basics
- linear Commit sequence
- prepare does not mutate formal knowledge
- reject does not mutate formal knowledge
- write lock
- stale revision/head conflict
- stdio MCP smoke test
- invalid Vault startup

Add tests for:
- opaque ID generation
- complete Project target state
- Project no-op with history-only Commit
- required Commit for historical Project changes
- maintenance correction exception
- accepted semantic fingerprint
- external_change_pending
- formatting-only manual edit
- Experience create
- Experience enrich with explicit base revision
- enrich stale revision
- Experience provenance union
- no-op enrich
- ChangeSet `conflicted` terminal state
- already-applied idempotency
- stable IDs between Preview and Apply
- Apply-time timestamps
- interrupted transaction detection/recovery
- minimal search
- fresh checkout install/typecheck/test

---

# 27. README — P1 rewrite

Current README documents the experimental v1.0.0 behavior and is now misleading.

Update only after implementation stabilizes.

It should clearly state:
- product boundary
- Host Agent vs Memory responsibility
- explicit confirmation path
- supported v1 Experience operations = create/enrich
- Markdown/Obsidian storage
- MCP usage
- fresh-install commands
- known remaining limitations

---

# 28. Recommended implementation order

Do not implement by file order.

## Phase A — contracts into code

1. Replace domain schemas with final Project / Commit / Experience v1.
2. Define canonical structured semantic states.
3. Define narrowed SaveProposal schema.
4. Define final ChangeSet schema including `conflicted`.
5. Update fixtures/unit schema tests.

## Phase B — storage correctness

6. Canonical Markdown renderer/parser for all three objects.
7. Accepted baseline/fingerprint storage and read-state detection.
8. Update repositories to final invariants.
9. Opaque ID generation.

## Phase C — prepare

10. Rewrite `prepareSave()` around:
    - supplied base Project revision/head
    - complete Project target
    - historical-change Commit requirement
    - Experience create/enrich only
    - stable generated IDs
    - resolved provenance
    - content fingerprints
    - no domain writes

11. Rewrite deterministic Preview.

## Phase D — apply

12. Rewrite preflight with revision + fingerprint + head.
13. Persist `conflicted` state.
14. Add Apply-time timestamps.
15. Add idempotent already-applied behavior.
16. Add transaction/recovery marker around multi-file Apply.
17. Improve stale lock handling.

## Phase E — interface

18. Update MemoryService.
19. Update MCP schemas/tool responses.
20. Add minimal search tool.
21. Remove old merge/supersede/lifecycle interfaces.

## Phase F — verification

22. Rewrite/adapt tests.
23. Clean install with `npm ci`.
24. `npm run typecheck`.
25. `npm test`.
26. real stdio MCP smoke test.
27. manual end-to-end Vault test in Obsidian.
28. commit all final docs and README.

---

# 29. What should NOT be implemented now

Do not spend v1 time on:
- Experience merge
- Experience supersede
- Experience archive
- Experience abstract
- immutable Experience revision snapshots
- vector search
- embeddings
- Web UI
- Obsidian plugin
- background watcher
- proactive capture
- autonomous memory maintenance
- second LLM/Memory Agent
- generic CRUD/file tools
- distributed transaction/locking
- event sourcing system

---

# 30. Overall assessment

The project is **closer to a usable v1 than the old schemas make it look**.

The architecture skeleton is broadly appropriate.

The main work is not adding more layers. It is replacing the experimental domain semantics with the frozen minimal v1 while preserving the good infrastructure already present.

Estimated code-change shape (not time estimate):

- **Keep mostly intact:** Vault path safety, atomic single-file helpers, repository architecture, MCP server architecture, error mapping.
- **Refactor substantially:** repositories, MemoryService, Preview, tests.
- **Rewrite:** `domain/schemas.ts`, most of `ChangeSetService`, Markdown domain mapping.
- **Add focused components:** accepted-baseline/fingerprint support, local transaction recovery marker, minimal search.

The implementation should be treated as **one focused v1 convergence pass**, not another sequence of product-design milestones.
