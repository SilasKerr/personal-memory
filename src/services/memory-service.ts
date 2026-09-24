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

  constructor(private readonly vault: Vault) {
    this.projects = new ProjectRepository(vault);
    this.commits = new CommitRepository(vault);
    this.experiences = new ExperienceRepository(vault);
    this.changeSets = new ChangeSetRepository(vault);
    this.lifecycle = new ChangeSetService(vault);
  }

  async projectList() {
    const projects = await this.projects.listInspected();
    return { projects: projects.map(({ project, state }) => ({
      id: project.metadata.id, name: project.content.name, lifecycle: project.content.lifecycle,
      goal: project.content.goal, revision: project.metadata.revision, updated_at: project.metadata.updated_at,
      read_state: state,
    })).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id)) };
  }

  async projectGet(projectId: string) {
    const inspected = await this.projects.inspect(idSchema.parse(projectId));
    if (!inspected) throw new NotFoundError('Project', projectId);
    return { project: inspected.project, read_state: inspected.state };
  }

  async commitList(projectId: string) {
    if (!await this.projects.inspect(idSchema.parse(projectId))) throw new NotFoundError('Project', projectId);
    const commits = await this.commits.list(projectId);
    return { commits: commits.map(({ metadata, content }) => ({
      id: metadata.id, sequence: metadata.sequence, created_at: metadata.created_at, title: content.title,
    })) };
  }

  async commitGet(projectId: string, commitId: string) {
    if (!await this.projects.inspect(idSchema.parse(projectId))) throw new NotFoundError('Project', projectId);
    const commit = await this.commits.get(projectId, idSchema.parse(commitId));
    if (!commit) throw new NotFoundError('Commit', commitId);
    return { commit };
  }

  async experienceList(filters: { maturity?: 'candidate' | 'validated' | 'principle'; project_id?: string } = {}) {
    if (filters.project_id) idSchema.parse(filters.project_id);
    const experiences = await this.experiences.list();
    const summaries = [];
    for (const experience of experiences) {
      const projectIds = new Set<string>();
      for (const commitId of experience.metadata.source_commits) {
        for (const { project } of await this.projects.listInspected()) {
          if (await this.commits.get(project.metadata.id, commitId)) projectIds.add(project.metadata.id);
        }
      }
      if (filters.maturity && experience.content.maturity !== filters.maturity) continue;
      if (filters.project_id && !projectIds.has(filters.project_id)) continue;
      summaries.push({
        id: experience.metadata.id, title: experience.content.title,
        core_statement: experience.content.core_statement, maturity: experience.content.maturity,
        source_projects: [...projectIds], updated_at: experience.metadata.updated_at,
      });
    }
    return { experiences: summaries };
  }

  async experienceGet(experienceId: string) {
    const inspected = await this.experiences.inspect(idSchema.parse(experienceId));
    if (!inspected) throw new NotFoundError('Experience', experienceId);
    return { experience: inspected.experience, read_state: inspected.state };
  }

  async search(input: { query: string; kind?: 'project' | 'experience'; project_id?: string }) {
    const terms = normalize(input.query).split(' ').filter(Boolean);
    const results: Array<{ kind: 'project' | 'experience'; id: string; title: string; snippet: string }> = [];
    if (input.kind !== 'experience') {
      const projects = await this.projects.list();
      for (const project of projects) {
        if (input.project_id && project.metadata.id !== input.project_id) continue;
        const haystack = normalize(JSON.stringify(project.content));
        if (terms.every((term) => haystack.includes(term))) results.push({
          kind: 'project', id: project.metadata.id, title: project.content.name,
          snippet: project.content.current_state,
        });
      }
    }
    if (input.kind !== 'project') {
      const experiences = await this.experiences.list();
      for (const experience of experiences) {
        if (input.project_id) {
          let matched = false;
          for (const commitId of experience.metadata.source_commits) {
            if (await this.commits.get(input.project_id, commitId)) matched = true;
          }
          if (!matched) continue;
        }
        const haystack = normalize(JSON.stringify(experience.content));
        if (terms.every((term) => haystack.includes(term))) results.push({
          kind: 'experience', id: experience.metadata.id, title: experience.content.title,
          snippet: experience.content.core_statement,
        });
      }
    }
    return { results };
  }

  async prepareSave(input: SaveProposal) {
    const changeSet = await this.lifecycle.prepareSave(saveProposalSchema.parse(input));
    return { status: 'pending_confirmation' as const, changeset_id: changeSet.id, preview: previewChangeSet(changeSet) };
  }

  async changesetGet(changeSetId: string) {
    const changeSet = await this.changeSets.get(idSchema.parse(changeSetId));
    if (!changeSet) throw new NotFoundError('ChangeSet', changeSetId);
    return { changeset_id: changeSet.id, status: changeSet.status, prepared_at: changeSet.prepared_at, preview: previewChangeSet(changeSet) };
  }

  async applyChangeSet(changeSetId: string) {
    const result = await this.lifecycle.applyChangeSet(idSchema.parse(changeSetId));
    return { status: result.outcome, changeset_id: result.changeSet.id, project_id: result.changeSet.project_id };
  }

  async rejectChangeSet(changeSetId: string) {
    const changeSet = await this.lifecycle.rejectChangeSet(idSchema.parse(changeSetId));
    return { status: 'rejected' as const, changeset_id: changeSet.id };
  }
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}
