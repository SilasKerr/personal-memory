import { idSchema, saveProposalSchema, type SaveProposal } from '../domain/schemas.js';
import { ChangeSetRepository } from '../repositories/changeset-repository.js';
import { CommitRepository } from '../repositories/commit-repository.js';
import { ExperienceRepository } from '../repositories/experience-repository.js';
import { NotFoundError } from '../repositories/errors.js';
import { ProjectRepository } from '../repositories/project-repository.js';
import { Vault } from '../storage/vault.js';
import { ChangeSetService } from './changeset-service.js';
import { previewChangeSet } from './preview.js';

export class MemoryService {
  private readonly projects: ProjectRepository;
  private readonly commits: CommitRepository;
  private readonly experiences: ExperienceRepository;
  private readonly changeSets: ChangeSetRepository;
  private readonly lifecycle: ChangeSetService;

  constructor(vault: Vault) {
    this.projects = new ProjectRepository(vault);
    this.commits = new CommitRepository(vault);
    this.experiences = new ExperienceRepository(vault);
    this.changeSets = new ChangeSetRepository(vault);
    this.lifecycle = new ChangeSetService(vault);
  }

  async projectList() {
    const projects = await this.projects.list();
    return { projects: projects.map(({ metadata }) => ({
      id: metadata.id, name: metadata.name, status: metadata.status,
      updated_at: metadata.updated_at, latest_commit: metadata.latest_commit,
    })).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id)) };
  }

  async projectGet(projectId: string) {
    const project = await this.projects.get(idSchema.parse(projectId));
    if (!project) throw new NotFoundError('Project', projectId);
    return { project };
  }

  async commitList(projectId: string) {
    await this.projectGet(projectId);
    const commits = await this.commits.list(projectId);
    return { commits: commits.map(({ metadata, body }) => ({
      id: metadata.id, sequence: metadata.sequence, created_at: metadata.created_at,
      title: heading(body),
    })) };
  }

  async commitGet(projectId: string, commitId: string) {
    await this.projectGet(projectId);
    const commit = await this.commits.get(projectId, idSchema.parse(commitId));
    if (!commit) throw new NotFoundError('Commit', commitId);
    return { commit };
  }

  async experienceList(filters: { status?: 'candidate' | 'validated' | 'principle'; lifecycle?: 'active' | 'merged' | 'superseded'; project_id?: string }) {
    if (filters.project_id !== undefined) idSchema.parse(filters.project_id);
    const experiences = await this.experiences.list();
    return { experiences: experiences.filter(({ metadata }) =>
      metadata.lifecycle === (filters.lifecycle ?? 'active') &&
      (filters.status === undefined || metadata.status === filters.status) &&
      (filters.project_id === undefined || metadata.source_projects.includes(filters.project_id))
    ).map(({ metadata, body }) => ({
      id: metadata.id, title: heading(body), status: metadata.status,
      lifecycle: metadata.lifecycle, updated_at: metadata.updated_at,
      source_projects: metadata.source_projects,
    })) };
  }

  async experienceGet(experienceId: string) {
    const experience = await this.experiences.get(idSchema.parse(experienceId));
    if (!experience) throw new NotFoundError('Experience', experienceId);
    return { experience };
  }

  async prepareSave(input: SaveProposal) {
    const changeSet = await this.lifecycle.prepareSave(saveProposalSchema.parse(input));
    return { status: 'pending_confirmation' as const, changeset_id: changeSet.id, preview: previewChangeSet(changeSet) };
  }

  async changesetGet(changeSetId: string) {
    const changeSet = await this.changeSets.get(idSchema.parse(changeSetId));
    if (!changeSet) throw new NotFoundError('ChangeSet', changeSetId);
    return { changeset_id: changeSet.id, status: changeSet.status, created_at: changeSet.created_at, preview: previewChangeSet(changeSet) };
  }

  async applyChangeSet(changeSetId: string) {
    const changeSet = await this.lifecycle.applyChangeSet(idSchema.parse(changeSetId));
    return { status: 'applied' as const, changeset_id: changeSet.id, project_id: changeSet.project_id };
  }

  async rejectChangeSet(changeSetId: string) {
    const changeSet = await this.lifecycle.rejectChangeSet(idSchema.parse(changeSetId));
    return { status: 'rejected' as const, changeset_id: changeSet.id };
  }
}

function heading(body: string): string {
  return /^# (.+)$/m.exec(body)?.[1] ?? '(untitled)';
}
