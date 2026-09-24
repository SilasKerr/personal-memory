import { randomUUID } from 'node:crypto';
import {
  changeSetSchema, commitSchema, experienceSchema, projectSchema, saveProposalSchema,
  type ChangeSet, type Commit, type Experience, type PreparedExperienceChange, type Project, type SaveProposal,
} from '../domain/schemas.js';
import { semanticFingerprint } from '../domain/markdown-content.js';
import { CommitRepository, serializeCommit } from '../repositories/commit-repository.js';
import { ChangeSetRepository } from '../repositories/changeset-repository.js';
import {
  ConflictError, ExternalChangePendingError, IntegrityError, InvalidStateError, NotFoundError,
} from '../repositories/errors.js';
import { ExperienceRepository, serializeExperience } from '../repositories/experience-repository.js';
import { ProjectRepository, serializeProject } from '../repositories/project-repository.js';
import { baselineFor, readBaseline } from '../storage/baseline.js';
import { Vault } from '../storage/vault.js';
import { assertNoIncompleteTransaction, plannedWrite, runTransaction } from '../storage/transaction.js';
import { withVaultWriteLock } from '../storage/write-lock.js';

function newId(prefix: 'prj' | 'cmt' | 'exp'): string { return `${prefix}-${randomUUID().replaceAll('-', '')}`; }
function laterThan(previous: string): string {
  const now = Date.now();
  return new Date(Math.max(now, Date.parse(previous) + 1)).toISOString();
}
function experienceState(value: Experience): object {
  return { content: value.content, source_commits: value.metadata.source_commits };
}

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
    await assertNoIncompleteTransaction(this.vault);
    const proposal = saveProposalSchema.parse(input);
    const isNew = proposal.project_id === null;
    if (isNew && (proposal.base_project_revision !== 0 || proposal.base_commit_head !== null || proposal.external_change)) {
      throw new InvalidStateError('New Project requires empty baseline and no external edit');
    }
    const projectId = proposal.project_id ?? newId('prj');
    const inspected = isNew ? null : await this.projects.inspect(projectId);
    if (!isNew && !inspected) throw new NotFoundError('Project', projectId);
    const project = inspected?.project ?? null;
    const projectPending = inspected?.state === 'external_change_pending';
    if (projectPending && !proposal.external_change) throw new ExternalChangePendingError('Project', projectId);
    if (projectPending && proposal.external_change === 'adopt' &&
        JSON.stringify(proposal.project_target) !== JSON.stringify(project!.content)) {
      throw new InvalidStateError('Adopt target must match external Project content');
    }
    if ((project?.metadata.revision ?? 0) !== proposal.base_project_revision) throw new ConflictError('Project revision changed');
    const history = await this.commits.list(projectId);
    const latest = history.at(-1);
    if ((latest?.metadata.id ?? null) !== proposal.base_commit_head) throw new ConflictError('Commit history changed');
    const changedFields = (Object.keys(proposal.project_target) as Array<keyof typeof proposal.project_target>)
      .filter((key) => isNew || JSON.stringify(proposal.project_target[key]) !== JSON.stringify(project!.content[key]));
    const historicalFields = ['goal', 'current_state', 'confirmed_decisions', 'open_questions', 'next_steps', 'lifecycle'];
    if ((projectPending || (!isNew && changedFields.some((key) => historicalFields.includes(key)))) &&
        proposal.change_kind === 'historical_change' && !proposal.commit) {
      throw new InvalidStateError('Historical Project change requires Commit');
    }
    if (proposal.change_kind === 'maintenance_correction' && proposal.commit) {
      throw new InvalidStateError('Maintenance correction cannot create a cognitive-stage Commit');
    }
    const commitId = proposal.commit ? newId('cmt') : null;
    const commitSequence = (latest?.metadata.sequence ?? 0) + 1;
    const revises = proposal.commit?.revises_commit_ids ?? [];
    for (const ref of revises) {
      const prior = history.find((item) => item.metadata.id === ref);
      if (!prior || prior.metadata.sequence >= commitSequence) throw new InvalidStateError('Invalid cognition revision reference');
    }

    const prepared: PreparedExperienceChange[] = [];
    let anyExternal = projectPending;
    const touched = new Set<string>();
    for (const change of proposal.experiences) {
      if (change.action === 'create') {
        const id = newId('exp');
        const sources = await this.resolveSources(change.source_commits ?? [], commitId);
        prepared.push({ action: 'create', id, target: change.target, source_commits: sources });
      } else {
        if (touched.has(change.target_id)) throw new InvalidStateError('Experience targeted twice');
        touched.add(change.target_id);
        const inspectedExperience = await this.experiences.inspect(change.target_id);
        if (!inspectedExperience) throw new NotFoundError('Experience', change.target_id);
        const current = inspectedExperience.experience;
        const experiencePending = inspectedExperience.state === 'external_change_pending';
        if (experiencePending && !proposal.external_change) throw new ExternalChangePendingError('Experience', change.target_id);
        if (experiencePending && proposal.external_change === 'adopt' &&
            JSON.stringify(change.target) !== JSON.stringify(current.content)) {
          throw new InvalidStateError('Adopt target must match external Experience content');
        }
        anyExternal ||= experiencePending;
        if (current.metadata.revision !== change.base_revision) throw new ConflictError('Experience revision changed');
        const baseline = await readBaseline(this.vault, 'experience', change.target_id);
        const sources = await this.resolveSources([
          ...(baseline.source_commits ?? []), ...current.metadata.source_commits, ...(change.source_commits ?? []),
        ], commitId);
        if (!experiencePending &&
            semanticFingerprint({ content: change.target, source_commits: sources }) === semanticFingerprint(experienceState(current))) continue;
        prepared.push({
          action: 'enrich', id: change.target_id, base_revision: change.base_revision,
          base_fingerprint: semanticFingerprint(experienceState(current)),
          target: change.target, source_commits: sources,
        });
      }
    }
    const commitChange = proposal.commit ? {
      id: commitId!, sequence: commitSequence, content: proposal.commit.content,
      revises_commit_ids: revises,
      experience_changes: prepared.map((item) => ({ action: item.action, experience_id: item.id })),
    } : null;
    if (proposal.external_change && !anyExternal) throw new InvalidStateError('No external semantic edit is pending');
    if (!changedFields.length && !projectPending && !commitChange && !prepared.length) throw new InvalidStateError('SaveProposal is a no-op');
    const changeSet = changeSetSchema.parse({
      id: randomUUID(), status: 'pending', prepared_at: new Date().toISOString(), completed_at: null,
      project_id: projectId, project_is_new: isNew, external_change: proposal.external_change ?? null,
      base_project_revision: project?.metadata.revision ?? 0,
      base_project_fingerprint: semanticFingerprint(project?.content ?? null),
      base_commit_head: proposal.base_commit_head, base_commit_sequence: latest?.metadata.sequence ?? 0,
      change_kind: proposal.change_kind,
      project_change: changedFields.length || projectPending ?
        { changed_fields: changedFields.length ? changedFields : ['external_adoption'], target: proposal.project_target } : null,
      commit_change: commitChange, experience_changes: prepared, ignored_items: proposal.ignored_items ?? [],
    });
    await this.changeSets.create(changeSet);
    return changeSet;
  }

  private async resolveSources(ids: string[], newCommitId: string | null): Promise<string[]> {
    const unique = [...new Set([...ids, ...(newCommitId ? [newCommitId] : [])])];
    for (const id of unique) {
      if (id === newCommitId) continue;
      const projectId = await this.findCommitProject(id);
      if (!projectId) throw new InvalidStateError(`Source Commit does not exist: ${id}`);
    }
    return unique;
  }

  private async findCommitProject(id: string): Promise<string | null> {
    for (const { project } of await this.projects.listInspected()) {
      if (await this.commits.get(project.metadata.id, id)) return project.metadata.id;
    }
    return null;
  }

  async applyChangeSet(id: string): Promise<{ outcome: 'applied' | 'already_applied' | 'conflicted'; changeSet: ChangeSet }> {
    return withVaultWriteLock(this.vault, async () => {
      await assertNoIncompleteTransaction(this.vault);
      const changeSet = await this.changeSets.get(id);
      if (!changeSet) throw new NotFoundError('ChangeSet', id);
      if (changeSet.status === 'applied') return { outcome: 'already_applied', changeSet };
      if (changeSet.status !== 'pending') throw new InvalidStateError(`ChangeSet is ${changeSet.status}`);
      let currentProject: Project | null;
      let currents: Map<string, Experience>;
      try {
        ({ project: currentProject, experiences: currents } = await this.preflight(changeSet));
      } catch (error) {
        if (!(error instanceof ConflictError || error instanceof ExternalChangePendingError ||
              error instanceof NotFoundError)) throw error;
        const conflicted = changeSetSchema.parse({ ...changeSet, status: 'conflicted', completed_at: new Date().toISOString() });
        await this.changeSets.update(conflicted);
        return { outcome: 'conflicted', changeSet: conflicted };
      }
      const now = new Date().toISOString();
      const writes = [];
      if (changeSet.commit_change) {
        const item = changeSet.commit_change;
        await this.vault.ensureCommitsDirectory(changeSet.project_id);
        const commit = commitSchema.parse({
          metadata: {
            type: 'commit', id: item.id, project_id: changeSet.project_id, sequence: item.sequence,
            created_at: now, revises_commit_ids: item.revises_commit_ids,
            experience_changes: item.experience_changes,
          },
          content: item.content,
        });
        writes.push(await plannedWrite(this.vault, this.vault.commitFile(changeSet.project_id, item.id), serializeCommit(commit)));
        writes.push(await plannedWrite(this.vault, this.vault.baselineFile('commit', item.id),
          JSON.stringify(baselineFor(item.id, 1, {
            content: commit.content, revises_commit_ids: item.revises_commit_ids,
            experience_changes: item.experience_changes, sequence: item.sequence,
          }, now)) + '\n'));
      }
      for (const item of changeSet.experience_changes) {
        const current = currents.get(item.id);
        const timestamp = current ? laterThan(current.metadata.updated_at) : now;
        const result = experienceSchema.parse({
          metadata: {
            type: 'experience', id: item.id, source_commits: item.source_commits,
            revision: current ? current.metadata.revision + 1 : 1,
            created_at: current?.metadata.created_at ?? timestamp, updated_at: timestamp,
          },
          content: item.target,
        });
        await this.vault.ensureExperiencesDirectory();
        writes.push(await plannedWrite(this.vault, this.vault.experienceFile(item.id), serializeExperience(result)));
        writes.push(await plannedWrite(this.vault, this.vault.baselineFile('experience', item.id),
          JSON.stringify(baselineFor(item.id, result.metadata.revision, result.content,
            result.metadata.created_at, result.metadata.source_commits, result.metadata.updated_at)) + '\n'));
      }
      if (changeSet.project_change) {
        if (changeSet.project_is_new) await this.vault.ensureProjectDirectory(changeSet.project_id);
        const result = projectSchema.parse({
          metadata: currentProject ? {
            ...currentProject.metadata, revision: currentProject.metadata.revision + 1,
            updated_at: laterThan(currentProject.metadata.updated_at),
          } : {
            type: 'project', id: changeSet.project_id, revision: 1, created_at: now, updated_at: now,
          },
          content: changeSet.project_change.target,
        });
        writes.push(await plannedWrite(this.vault, this.vault.projectFile(result.metadata.id), serializeProject(result)));
        writes.push(await plannedWrite(this.vault, this.vault.baselineFile('project', result.metadata.id),
          JSON.stringify(baselineFor(result.metadata.id, result.metadata.revision, result.content,
            result.metadata.created_at, undefined, result.metadata.updated_at)) + '\n'));
      }
      const applied = changeSetSchema.parse({ ...changeSet, status: 'applied', completed_at: now });
      const YAML = await import('yaml');
      writes.push(await plannedWrite(this.vault, this.vault.changesetFile(id), YAML.default.stringify(applied)));
      await runTransaction(this.vault, id, writes);
      return { outcome: 'applied', changeSet: applied };
    });
  }

  async rejectChangeSet(id: string): Promise<ChangeSet> {
    return withVaultWriteLock(this.vault, async () => {
      await assertNoIncompleteTransaction(this.vault);
      const changeSet = await this.changeSets.get(id);
      if (!changeSet) throw new NotFoundError('ChangeSet', id);
      if (changeSet.status !== 'pending') throw new InvalidStateError(`ChangeSet is ${changeSet.status}`);
      const rejected = changeSetSchema.parse({ ...changeSet, status: 'rejected', completed_at: new Date().toISOString() });
      await this.changeSets.update(rejected);
      return rejected;
    });
  }

  private async preflight(changeSet: ChangeSet): Promise<{ project: Project | null; experiences: Map<string, Experience> }> {
    const inspectedProject = await this.projects.inspect(changeSet.project_id);
    const project = inspectedProject?.project ?? null;
    if (changeSet.project_is_new) {
      if (project || changeSet.base_project_revision !== 0) throw new ConflictError('New Project ID already exists');
    } else {
      if (!project || project.metadata.revision !== changeSet.base_project_revision ||
          semanticFingerprint(project.content) !== changeSet.base_project_fingerprint ||
          (inspectedProject?.state === 'external_change_pending' && !changeSet.external_change) ||
          (inspectedProject?.state === 'accepted' && changeSet.external_change && changeSet.project_change?.changed_fields.includes('external_adoption'))) {
        throw new ConflictError('Project baseline changed');
      }
    }
    const latest = (await this.commits.list(changeSet.project_id)).at(-1);
    if ((latest?.metadata.id ?? null) !== changeSet.base_commit_head ||
        (latest?.metadata.sequence ?? 0) !== changeSet.base_commit_sequence) throw new ConflictError('Commit history changed');
    if (changeSet.commit_change && await this.commits.get(changeSet.project_id, changeSet.commit_change.id)) {
      throw new ConflictError('Prepared Commit ID already exists');
    }
    const currents = new Map<string, Experience>();
    for (const item of changeSet.experience_changes) {
      if (item.action === 'create') {
        if (await this.experiences.get(item.id)) throw new ConflictError('Prepared Experience ID already exists');
      } else {
        const inspectedExperience = await this.experiences.inspect(item.id);
        const current = inspectedExperience?.experience ?? null;
        if (!current || current.metadata.revision !== item.base_revision ||
            semanticFingerprint(experienceState(current)) !== item.base_fingerprint ||
            (inspectedExperience?.state === 'external_change_pending' && !changeSet.external_change)) {
          throw new ConflictError('Experience baseline changed');
        }
        currents.set(item.id, current);
      }
      for (const sourceId of item.source_commits) {
        if (sourceId === changeSet.commit_change?.id) continue;
        if (!await this.findCommitProject(sourceId)) throw new ConflictError('Experience source Commit changed');
      }
    }
    return { project, experiences: currents };
  }
}
