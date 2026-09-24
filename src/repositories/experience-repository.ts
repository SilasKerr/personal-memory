import { readFile, readdir } from 'node:fs/promises';
import { parseExperience, renderExperience } from '../domain/markdown-content.js';
import { experienceMetadataSchema, experienceSchema, type Experience } from '../domain/schemas.js';
import { createAtomic, replaceAtomic } from '../storage/atomic-file.js';
import { assertAccepted, baselineFor, writeBaseline } from '../storage/baseline.js';
import { parseMarkdown, serializeMarkdown } from '../storage/markdown.js';
import { Vault } from '../storage/vault.js';
import { AlreadyExistsError, ExternalChangePendingError, hasFileCode, NotFoundError } from './errors.js';

export function serializeExperience(experience: Experience): string {
  const validated = experienceSchema.parse(experience);
  return serializeMarkdown(validated.metadata, renderExperience(validated.content), experienceMetadataSchema);
}

export class ExperienceRepository {
  constructor(private readonly vault: Vault) {}

  async create(experience: Experience): Promise<void> {
    const validated = experienceSchema.parse(experience);
    if (validated.metadata.revision !== 1) throw new Error('New Experiences must start at revision 1');
    await this.vault.ensureExperiencesDirectory();
    try {
      await createAtomic(this.vault.experienceFile(validated.metadata.id), serializeExperience(validated));
      await writeBaseline(this.vault, 'experience', baselineFor(validated.metadata.id, 1, validated.content,
        validated.metadata.created_at, validated.metadata.source_commits, validated.metadata.updated_at));
    } catch (error) {
      if (hasFileCode(error, 'EEXIST')) throw new AlreadyExistsError('Experience', validated.metadata.id);
      throw error;
    }
  }

  async inspect(id: string): Promise<{ experience: Experience; state: 'accepted' | 'external_change_pending' } | null> {
    const file = this.vault.experienceFile(id);
    try {
      await this.vault.assertExistingPathInsideRoot(file);
      const parsed = parseMarkdown(await readFile(file, 'utf8'), experienceMetadataSchema);
      if (parsed.metadata.id !== id) throw new Error('Experience id does not match path');
      const experience = experienceSchema.parse({ metadata: parsed.metadata, content: parseExperience(parsed.body) });
      try {
        await assertAccepted(this.vault, 'experience', id, experience.metadata.revision, experience.content,
          experience.metadata.created_at, experience.metadata.source_commits, experience.metadata.updated_at);
        return { experience, state: 'accepted' };
      } catch (error) {
        if (error instanceof ExternalChangePendingError) return { experience, state: 'external_change_pending' };
        throw error;
      }
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async get(id: string): Promise<Experience | null> {
    const inspected = await this.inspect(id);
    if (inspected?.state === 'external_change_pending') throw new ExternalChangePendingError('Experience', id);
    return inspected?.experience ?? null;
  }

  async list(): Promise<Experience[]> {
    const directory = this.vault.experiencesDirectory();
    try {
      await this.vault.assertExistingPathInsideRoot(directory);
      const names = await readdir(directory);
      const experiences: Experience[] = [];
      for (const name of names.filter((name) => name.endsWith('.md')).sort()) {
        const inspected = await this.inspect(name.slice(0, -3));
        if (inspected?.state === 'accepted') experiences.push(inspected.experience);
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
    if (validated.metadata.created_at !== current.metadata.created_at) throw new Error('Experience created_at cannot change');
    if (validated.metadata.revision !== current.metadata.revision + 1) throw new Error('Experience revision must increase by 1');
    if (validated.metadata.updated_at === current.metadata.updated_at) throw new Error('Experience updated_at must change');
    await replaceAtomic(this.vault.experienceFile(validated.metadata.id), serializeExperience(validated));
    await writeBaseline(this.vault, 'experience', baselineFor(validated.metadata.id, validated.metadata.revision,
      validated.content, validated.metadata.created_at, validated.metadata.source_commits, validated.metadata.updated_at));
  }
}
