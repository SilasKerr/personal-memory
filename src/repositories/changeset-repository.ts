import { readFile } from 'node:fs/promises';
import YAML from 'yaml';
import { changeSetSchema, type ChangeSet } from '../domain/schemas.js';
import { createAtomic, replaceAtomic } from '../storage/atomic-file.js';
import { Vault } from '../storage/vault.js';
import { AlreadyExistsError, hasFileCode, NotFoundError } from './errors.js';

export class ChangeSetRepository {
  constructor(private readonly vault: Vault) {}

  async create(changeSet: ChangeSet): Promise<void> {
    const validated = changeSetSchema.parse(changeSet);
    const file = this.vault.changesetFile(validated.id);
    await this.vault.initialize();
    try {
      await createAtomic(file, YAML.stringify(validated));
    } catch (error) {
      if (hasFileCode(error, 'EEXIST')) throw new AlreadyExistsError('ChangeSet', validated.id);
      throw error;
    }
  }

  async get(id: string): Promise<ChangeSet | null> {
    const file = this.vault.changesetFile(id);
    try {
      await this.vault.assertExistingPathInsideRoot(file);
      const document = YAML.parseDocument(await readFile(file, 'utf8'), { uniqueKeys: true });
      if (document.errors.length) throw new Error(`Invalid ChangeSet YAML: ${document.errors[0].message}`);
      const changeSet = changeSetSchema.parse(document.toJS());
      if (changeSet.id !== id) throw new Error('ChangeSet id does not match its path');
      return changeSet;
    } catch (error) {
      if (hasFileCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  async update(changeSet: ChangeSet): Promise<void> {
    const validated = changeSetSchema.parse(changeSet);
    if (!await this.get(validated.id)) throw new NotFoundError('ChangeSet', validated.id);
    await replaceAtomic(this.vault.changesetFile(validated.id), YAML.stringify(validated));
  }
}
