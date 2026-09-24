import { readFile, readdir } from 'node:fs/promises';
import { experienceMetadataSchema, experienceSchema, type Experience } from '../domain/schemas.js';
import { createAtomic, replaceAtomic } from '../storage/atomic-file.js';
import { parseMarkdown, serializeMarkdown } from '../storage/markdown.js';
import { Vault } from '../storage/vault.js';
import { AlreadyExistsError, hasFileCode, NotFoundError } from './errors.js';

export class ExperienceRepository {
  constructor(private readonly vault: Vault) {}

  async create(experience: Experience): Promise<void> {
    const validated = experienceSchema.parse(experience);
    const file = this.vault.experienceFile(validated.metadata.id);
    await this.vault.ensureExperiencesDirectory();
    try {
      if (validated.metadata.revision !== 1) throw new Error('New Experiences must start at revision 1');
      await createAtomic(file, serializeMarkdown(validated.metadata, validated.body, experienceMetadataSchema));
    } catch (error) {
      if (hasFileCode(error, 'EEXIST')) throw new AlreadyExistsError('Experience', validated.metadata.id);
      throw error;
    }
  }

  async get(id: string): Promise<Experience | null> {
    const file = this.vault.experienceFile(id);
    try {
      await this.vault.assertExistingPathInsideRoot(file);
      const experience = parseMarkdown(await readFile(file, 'utf8'), experienceMetadataSchema);
      if (experience.metadata.id !== id) throw new Error('Experience id does not match its path');
      return experienceSchema.parse(experience);
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async list(): Promise<Experience[]> {
    const directory = this.vault.experiencesDirectory();
    try {
      await this.vault.assertExistingPathInsideRoot(directory);
      const names = await readdir(directory);
      const experiences: Experience[] = [];
      for (const name of names.filter((name) => name.endsWith('.md')).sort()) {
        const experience = await this.get(name.slice(0, -3));
        if (experience) experiences.push(experience);
      }
      return experiences;
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return [];
      throw error;
    }
  }

  async update(experience: Experience): Promise<void> {
    const validated = experienceSchema.parse(experience);
    const current = await this.get(validated.metadata.id);
    if (!current) throw new NotFoundError('Experience', validated.metadata.id);
    if (validated.metadata.created_at !== current.metadata.created_at) {
      throw new Error('Experience created_at cannot change');
    }
    if (validated.metadata.revision !== current.metadata.revision + 1) throw new Error('Experience revision must increase by 1');
    if (validated.metadata.updated_at === current.metadata.updated_at) throw new Error('Experience updated_at must change');
    await replaceAtomic(this.vault.experienceFile(validated.metadata.id), serializeMarkdown(validated.metadata, validated.body, experienceMetadataSchema));
  }
}
