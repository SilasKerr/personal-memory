import { readFile, readdir } from 'node:fs/promises';
import { projectMetadataSchema, projectSchema, type Project } from '../domain/schemas.js';
import { createAtomic, replaceAtomic } from '../storage/atomic-file.js';
import { parseMarkdown, serializeMarkdown } from '../storage/markdown.js';
import { Vault } from '../storage/vault.js';
import { AlreadyExistsError, hasFileCode, NotFoundError } from './errors.js';

export class ProjectRepository {
  constructor(private readonly vault: Vault) {}

  async create(project: Project): Promise<void> {
    const validated = projectSchema.parse(project);
    if (validated.metadata.revision !== 1) throw new Error('New Projects must start at revision 1');
    const file = this.vault.projectFile(validated.metadata.id);
    await this.vault.ensureProjectDirectory(validated.metadata.id);
    try {
      await createAtomic(file, serializeMarkdown(validated.metadata, validated.body, projectMetadataSchema));
    } catch (error) {
      if (hasFileCode(error, 'EEXIST')) throw new AlreadyExistsError('Project', validated.metadata.id);
      throw error;
    }
  }

  async get(id: string): Promise<Project | null> {
    const file = this.vault.projectFile(id);
    try {
      await this.vault.assertExistingPathInsideRoot(file);
      const project = parseMarkdown(await readFile(file, 'utf8'), projectMetadataSchema);
      if (project.metadata.id !== id) throw new Error('Project id does not match its path');
      return projectSchema.parse(project);
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async exists(id: string): Promise<boolean> {
    return (await this.get(id)) !== null;
  }

  async list(): Promise<Project[]> {
    const directory = this.vault.projectsDirectory();
    try {
      await this.vault.assertExistingPathInsideRoot(directory);
      const entries = await readdir(directory, { withFileTypes: true });
      const projects: Project[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const project = await this.get(entry.name);
        if (project) projects.push(project);
      }
      return projects;
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return [];
      throw error;
    }
  }

  async update(project: Project): Promise<void> {
    const validated = projectSchema.parse(project);
    const current = await this.get(validated.metadata.id);
    if (!current) throw new NotFoundError('Project', validated.metadata.id);
    if (validated.metadata.revision !== current.metadata.revision + 1) throw new Error('Project revision must increase by 1');
    if (validated.metadata.created_at !== current.metadata.created_at) throw new Error('Project created_at cannot change');
    if (validated.metadata.updated_at === current.metadata.updated_at) throw new Error('Project updated_at must change');
    await replaceAtomic(this.vault.projectFile(validated.metadata.id), serializeMarkdown(validated.metadata, validated.body, projectMetadataSchema));
  }
}
