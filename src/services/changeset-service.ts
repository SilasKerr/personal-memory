import { randomUUID } from 'node:crypto';
import {
  changeSetSchema, commitSchema, experienceSchema, projectSchema, saveProposalSchema,
  type ChangeSet, type Commit, type Experience, type ExperienceProposal, type PreparedExperienceChange,
  type Project, type SaveProposal,
} from '../domain/schemas.js';
import { CommitRepository } from '../repositories/commit-repository.js';
import { ChangeSetRepository } from '../repositories/changeset-repository.js';
import { ConflictError, InvalidStateError, NotFoundError } from '../repositories/errors.js';
import { ExperienceRepository } from '../repositories/experience-repository.js';
import { ProjectRepository } from '../repositories/project-repository.js';
import { Vault } from '../storage/vault.js';
import { withVaultWriteLock } from '../storage/write-lock.js';

type NewExperienceInput = Extract<ExperienceProposal, { action: 'create' }>;

export class ChangeSetService {
  private readonly projects: ProjectRepository;
  private readonly commits: CommitRepository;
  private readonly experiences: ExperienceRepository;
  private readonly changeSets: ChangeSetRepository;

  constructor(private readonly vault: Vault) {
    this.projects = new ProjectRepository(vault);
    this.commits = new CommitRepository(vault);
    this.experiences = new ExperienceRepository(vault);
    this.changeSets = new ChangeSetRepository(vault);
  }

  async prepareSave(input: SaveProposal): Promise<ChangeSet> {
    const proposal = saveProposalSchema.parse(input);
    const project = await this.projects.get(proposal.project_id);
    if (!project) throw new NotFoundError('Project', proposal.project_id);
    const history = await this.commits.list(proposal.project_id);
    const latest = history.at(-1);
    const now = new Date().toISOString();
    const nextCommit = proposal.commit ? commitSchema.parse({
      metadata: {
        type: 'commit', id: `${proposal.project_id}-${String((latest?.metadata.sequence ?? 0) + 1).padStart(4, '0')}`,
        project_id: proposal.project_id, sequence: (latest?.metadata.sequence ?? 0) + 1,
        created_at: now, previous_commit: latest?.metadata.id ?? null,
      },
      body: withHeading(proposal.commit.title, proposal.commit.body),
    }) : null;

    const changedFields: Array<'name' | 'status' | 'body' | 'latest_commit'> = [];
    const update = proposal.project_update;
    if (update?.name !== undefined && update.name !== project.metadata.name) changedFields.push('name');
    if (update?.status !== undefined && update.status !== project.metadata.status) changedFields.push('status');
    if (update?.body !== undefined && update.body !== project.body) changedFields.push('body');
    if (nextCommit && nextCommit.metadata.id !== project.metadata.latest_commit) changedFields.push('latest_commit');
    const projectChange = changedFields.length ? {
      base_revision: project.metadata.revision,
      changed_fields: changedFields,
      result: projectSchema.parse({
        metadata: {
          ...project.metadata,
          name: update?.name ?? project.metadata.name,
          status: update?.status ?? project.metadata.status,
          latest_commit: nextCommit?.metadata.id ?? project.metadata.latest_commit,
          revision: project.metadata.revision + 1,
          updated_at: nextTimestamp(project.metadata.updated_at),
        },
        body: update?.body ?? project.body,
      }),
    } : null;

    const prepared: PreparedExperienceChange[] = [];
    const reservedIds = new Set<string>();
    const updatedIds = new Set<string>();
    const sourceCommit = nextCommit?.metadata.id ?? latest?.metadata.id;
    const createExperience = async (source: Omit<NewExperienceInput, 'action'>, relations: Partial<Experience['metadata']> = {}): Promise<Experience> => {
      const id = await this.allocateExperienceId(source.title, reservedIds);
      reservedIds.add(id);
      return experienceSchema.parse({
        metadata: {
          type: 'experience', id, status: source.status ?? 'candidate', lifecycle: 'active', revision: 1,
          created_at: now, updated_at: now, source_projects: [proposal.project_id],
          source_commits: sourceCommit ? [sourceCommit] : [], supersedes: [], superseded_by: null,
          merged_from: [], merged_into: null, abstracted_from: [], tags: source.tags ?? [], ...relations,
        },
        body: withHeading(source.title, source.body),
      });
    };
    const readTarget = async (id: string): Promise<Experience> => {
      if (updatedIds.has(id)) throw new Error(`Experience is updated more than once: ${id}`);
      const current = await this.experiences.get(id);
      if (!current) throw new NotFoundError('Experience', id);
      updatedIds.add(id);
      return current;
    };
    const updateExperience = (current: Experience, purpose: 'enrich' | 'supersede' | 'merge', changes: Partial<Experience['metadata']>, body = current.body): void => {
      prepared.push({
        action: 'update', purpose, target_id: current.metadata.id, base_revision: current.metadata.revision,
        result: experienceSchema.parse({
          metadata: { ...current.metadata, ...changes, revision: current.metadata.revision + 1, updated_at: nextTimestamp(current.metadata.updated_at) },
          body,
        }),
      });
    };

    for (const change of proposal.experience_changes) {
      switch (change.action) {
        case 'create': {
          prepared.push({ action: 'create', purpose: 'create', result: await createExperience(change) });
          break;
        }
        case 'enrich': {
          const current = await readTarget(change.target_id);
          updateExperience(current, 'enrich', {
            status: change.status ?? current.metadata.status,
            tags: change.tags ?? current.metadata.tags,
          }, change.body);
          break;
        }
        case 'supersede': {
          const current = await readTarget(change.target_id);
          if (current.metadata.lifecycle !== 'active') throw new Error('Only active Experiences can be superseded');
          const replacement = await createExperience(change.replacement, { supersedes: [current.metadata.id] });
          prepared.push({ action: 'create', purpose: 'supersede', result: replacement });
          updateExperience(current, 'supersede', { lifecycle: 'superseded', superseded_by: replacement.metadata.id });
          break;
        }
        case 'merge': {
          const sources: Experience[] = [];
          for (const id of change.source_ids) {
            const current = await readTarget(id);
            if (current.metadata.lifecycle !== 'active') throw new Error('Only active Experiences can be merged');
            sources.push(current);
          }
          const result = await createExperience(change.result, { merged_from: change.source_ids });
          prepared.push({ action: 'create', purpose: 'merge', result });
          for (const current of sources) updateExperience(current, 'merge', { lifecycle: 'merged', merged_into: result.metadata.id });
          break;
        }
      }
    }

    const changeSet = changeSetSchema.parse({
      id: randomUUID(), status: 'pending', created_at: now, applied_at: null, rejected_at: null,
      project_id: proposal.project_id, base_project_revision: project.metadata.revision,
      base_commit_id: latest?.metadata.id ?? null, base_commit_sequence: latest?.metadata.sequence ?? 0,
      project_change: projectChange, commit_change: nextCommit,
      experience_changes: prepared, ignored_items: proposal.ignored_items,
    });
    await this.changeSets.create(changeSet);
    return changeSet;
  }

  async applyChangeSet(id: string): Promise<ChangeSet> {
    return withVaultWriteLock(this.vault, async () => {
      const changeSet = await this.requirePending(id);
      await this.preflight(changeSet);
      if (changeSet.commit_change) await this.commits.create(changeSet.commit_change);
      for (const change of changeSet.experience_changes) {
        if (change.action === 'create') await this.experiences.create(change.result);
        else await this.experiences.update(change.result);
      }
      if (changeSet.project_change) await this.projects.update(changeSet.project_change.result);
      const applied = changeSetSchema.parse({ ...changeSet, status: 'applied', applied_at: new Date().toISOString() });
      await this.changeSets.update(applied);
      return applied;
    });
  }

  async rejectChangeSet(id: string): Promise<ChangeSet> {
    return withVaultWriteLock(this.vault, async () => {
      const changeSet = await this.requirePending(id);
      const rejected = changeSetSchema.parse({ ...changeSet, status: 'rejected', rejected_at: new Date().toISOString() });
      await this.changeSets.update(rejected);
      return rejected;
    });
  }

  private async requirePending(id: string): Promise<ChangeSet> {
    const changeSet = await this.changeSets.get(id);
    if (!changeSet) throw new NotFoundError('ChangeSet', id);
    if (changeSet.status !== 'pending') throw new InvalidStateError(`ChangeSet is ${changeSet.status}`);
    return changeSet;
  }

  private async preflight(changeSet: ChangeSet): Promise<void> {
    changeSetSchema.parse(changeSet);
    const currentProject = await this.projects.get(changeSet.project_id);
    if (!currentProject || currentProject.metadata.revision !== changeSet.base_project_revision) throw new ConflictError('Project revision changed');
    const projectChange = changeSet.project_change;
    if (projectChange) {
      const result = projectChange.result.metadata;
      if (projectChange.base_revision !== changeSet.base_project_revision || result.id !== changeSet.project_id ||
          result.revision !== currentProject.metadata.revision + 1 || result.created_at !== currentProject.metadata.created_at ||
          result.updated_at === currentProject.metadata.updated_at) throw new ConflictError('Prepared Project result is stale or invalid');
    }
    const history = await this.commits.list(changeSet.project_id);
    const latest = history.at(-1);
    if ((latest?.metadata.id ?? null) !== changeSet.base_commit_id ||
        (latest?.metadata.sequence ?? 0) !== changeSet.base_commit_sequence) throw new ConflictError('Commit history changed');
    const commit = changeSet.commit_change;
    if (commit) {
      await this.vault.ensureCommitsDirectory(changeSet.project_id);
      const metadata = commit.metadata;
      if (metadata.project_id !== changeSet.project_id || metadata.sequence !== (latest?.metadata.sequence ?? 0) + 1 ||
          metadata.previous_commit !== (latest?.metadata.id ?? null) || await this.commits.get(changeSet.project_id, metadata.id) ||
          projectChange?.result.metadata.latest_commit !== metadata.id) throw new ConflictError('Commit history changed');
    }
    const creates = new Set<string>();
    const updates = new Set<string>();
    if (changeSet.experience_changes.length) await this.vault.ensureExperiencesDirectory();
    for (const change of changeSet.experience_changes) {
      const result = change.result.metadata;
      if (change.action === 'create') {
        if (result.revision !== 1 || creates.has(result.id) || await this.experiences.get(result.id)) throw new ConflictError(`Experience create target changed: ${result.id}`);
        creates.add(result.id);
      } else {
        const current = await this.experiences.get(change.target_id);
        if (!current || current.metadata.revision !== change.base_revision || result.id !== change.target_id ||
            result.revision !== change.base_revision + 1 || result.created_at !== current.metadata.created_at ||
            result.updated_at === current.metadata.updated_at || updates.has(change.target_id)) {
          throw new ConflictError(`Experience revision changed: ${change.target_id}`);
        }
        updates.add(change.target_id);
      }
    }
    for (const id of creates) if (updates.has(id)) throw new ConflictError(`Experience create/update overlap: ${id}`);
  }

  private async allocateExperienceId(title: string, reserved: Set<string>): Promise<string> {
    const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'experience';
    let id = base;
    for (let suffix = 2; reserved.has(id) || await this.experiences.get(id); suffix++) id = `${base}-${suffix}`;
    return id;
  }
}

function withHeading(title: string, body: string): string {
  return `# ${title}\n\n${body}`;
}

function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}
