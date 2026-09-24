import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';
import { idSchema } from '../domain/schemas.js';

export class Vault {
  constructor(readonly root: string) {}

  async initialize(): Promise<void> {
    await this.ensureDirectory('Projects');
    await this.ensureDirectory('Experiences');
    await this.ensureDirectory('.memory', 'changesets');
    await writeFile(path.join(this.root, '.memory', 'config.yaml'), 'version: 1\n', { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }

  async validateExisting(): Promise<void> {
    const requiredDirectories = [this.root, this.projectsDirectory(), this.experiencesDirectory(), path.join(this.root, '.memory'), path.join(this.root, '.memory', 'changesets')];
    try {
      for (const directory of requiredDirectories) {
        await this.assertExistingPathInsideRoot(directory);
        if (!(await stat(directory)).isDirectory()) throw new Error(`Not a directory: ${directory}`);
      }
      const configFile = path.join(this.root, '.memory', 'config.yaml');
      await this.assertExistingPathInsideRoot(configFile);
      const document = YAML.parseDocument(await readFile(configFile, 'utf8'), { uniqueKeys: true });
      if (document.errors.length) throw new Error(`Invalid Vault config: ${document.errors[0].message}`);
      z.strictObject({ version: z.literal(1) }).parse(document.toJS());
    } catch (error) {
      throw new Error(`Invalid Personal Memory Vault at ${this.root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  projectsDirectory(): string { return path.join(this.root, 'Projects'); }
  experiencesDirectory(): string { return path.join(this.root, 'Experiences'); }

  projectDirectory(projectId: string): string {
    return path.join(this.projectsDirectory(), idSchema.parse(projectId));
  }

  projectFile(projectId: string): string {
    return path.join(this.projectDirectory(projectId), 'project.md');
  }

  commitsDirectory(projectId: string): string {
    return path.join(this.projectDirectory(projectId), 'commits');
  }

  commitFile(projectId: string, commitId: string): string {
    return path.join(this.commitsDirectory(projectId), `${idSchema.parse(commitId)}.md`);
  }

  experienceFile(experienceId: string): string {
    return path.join(this.experiencesDirectory(), `${idSchema.parse(experienceId)}.md`);
  }

  changesetFile(changeSetId: string): string {
    return path.join(this.root, '.memory', 'changesets', `${idSchema.parse(changeSetId)}.yaml`);
  }

  writeLockFile(): string {
    return path.join(this.root, '.memory', 'write.lock');
  }

  async ensureProjectDirectory(projectId: string): Promise<void> {
    await this.ensureDirectory('Projects', idSchema.parse(projectId));
  }

  async ensureCommitsDirectory(projectId: string): Promise<void> {
    await this.ensureDirectory('Projects', idSchema.parse(projectId), 'commits');
  }

  async ensureExperiencesDirectory(): Promise<void> {
    await this.ensureDirectory('Experiences');
  }

  async assertExistingPathInsideRoot(file: string): Promise<void> {
    const [root, target] = await Promise.all([realpath(this.root), realpath(file)]);
    if (!isInside(root, target)) throw new Error('Path escapes Vault root');
  }

  private async ensureDirectory(...segments: string[]): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root);
    let current = this.root;
    for (const segment of segments) {
      current = path.join(current, segment);
      await mkdir(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
      const actual = await realpath(current);
      if (!isInside(root, actual)) throw new Error('Path escapes Vault root');
    }
  }
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}
