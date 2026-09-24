import { readFile, readdir } from 'node:fs/promises';
import { parseProject, renderProject } from '../domain/markdown-content.js';
import { projectMetadataSchema, projectSchema, type Project } from '../domain/schemas.js';
import { createAtomic, replaceAtomic } from '../storage/atomic-file.js';
import { assertAccepted, baselineFor, writeBaseline } from '../storage/baseline.js';
import { parseMarkdown, serializeMarkdown } from '../storage/markdown.js';
import { Vault } from '../storage/vault.js';
import { AlreadyExistsError, ExternalChangePendingError, hasFileCode, NotFoundError } from './errors.js';

export function serializeProject(project: Project): string {
  const validated = projectSchema.parse(project);
  return serializeMarkdown(validated.metadata, renderProject(validated.content), projectMetadataSchema);
}

export class ProjectRepository {
  constructor(private readonly vault: Vault) {}

  async create(project: Project): Promise<void> {
    const validated = projectSchema.parse(project);
    if (validated.metadata.revision !== 1) throw new Error('New Projects must start at revision 1');
    await this.vault.ensureProjectDirectory(validated.metadata.id);
    try {
      await createAtomic(this.vault.projectFile(validated.metadata.id), serializeProject(validated));
      await writeBaseline(this.vault, 'project', baselineFor(validated.metadata.id, 1, validated.content, validated.metadata.created_at, undefined, validated.metadata.updated_at));
    } catch (error) {
      if (hasFileCode(error, 'EEXIST')) throw new AlreadyExistsError('Project', validated.metadata.id);
      throw error;
    }
  }

  async inspect(id: string): Promise<{ project: Project; state: 'accepted' | 'external_change_pending' } | null> {
    const file = this.vault.projectFile(id);
    try {
      await this.vault.assertExistingPathInsideRoot(file);
      const parsed = parseMarkdown(await readFile(file, 'utf8'), projectMetadataSchema);
      if (parsed.metadata.id !== id) throw new Error('Project id does not match its path');
      const project = projectSchema.parse({ metadata: parsed.metadata, content: parseProject(parsed.body) });
      try {
        await assertAccepted(this.vault, 'project', id, project.metadata.revision, project.content, project.metadata.created_at, undefined, project.metadata.updated_at);
        return { project, state: 'accepted' };
      } catch (error) {
        if (error instanceof ExternalChangePendingError) return { project, state: 'external_change_pending' };
        throw error;
      }
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async get(id: string): Promise<Project | null> {
    const inspected = await this.inspect(id);
    if (inspected?.state === 'external_change_pending') throw new ExternalChangePendingError('Project', id);
    return inspected?.project ?? null;
  }

  async listInspected(): Promise<Array<{ project: Project; state: 'accepted' | 'external_change_pending' }>> {
    const directory = this.vault.projectsDirectory();
    try {
      await this.vault.assertExistingPathInsideRoot(directory);
      const entries = await readdir(directory, { withFileTypes: true });
      const projects: Array<{ project: Project; state: 'accepted' | 'external_change_pending' }> = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const project = await this.inspect(entry.name);
        if (project) projects.push(project);
      }
      return projects;
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return [];
      throw error;
    }
  }

  async list(): Promise<Project[]> {
    return (await this.listInspected()).filter((item) => item.state === 'accepted').map((item) => item.project);
  }

  async update(project: Project): Promise<void> {
    const validated = projectSchema.parse(project);
    const current = await this.get(validated.metadata.id);
    if (!current) throw new NotFoundError('Project', validated.metadata.id);
    if (validated.metadata.revision !== current.metadata.revision + 1) throw new Error('Project revision must increase by 1');
    if (validated.metadata.created_at !== current.metadata.created_at) throw new Error('Project created_at cannot change');
    if (validated.metadata.updated_at === current.metadata.updated_at) throw new Error('Project updated_at must change');
    await replaceAtomic(this.vault.projectFile(validated.metadata.id), serializeProject(validated));
    await writeBaseline(this.vault, 'project', baselineFor(validated.metadata.id, validated.metadata.revision, validated.content, validated.metadata.created_at, undefined, validated.metadata.updated_at));
  }
}
