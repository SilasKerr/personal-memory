import { createHash } from 'node:crypto';
import { lstat, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { IntegrityError, hasFileCode } from '../repositories/errors.js';
import { createAtomic, replaceAtomic } from './atomic-file.js';
import { Vault } from './vault.js';

const entrySchema = z.strictObject({
  relative_path: z.string().min(1), before_hash: z.string().length(64).nullable(), after: z.string(),
});
const journalSchema = z.strictObject({ changeset_id: z.string(), writes: z.array(entrySchema) });
type Entry = z.infer<typeof entrySchema>;
function hash(contents: string): string { return createHash('sha256').update(contents).digest('hex'); }

function safeFile(vault: Vault, relative: string): string {
  if (path.isAbsolute(relative) || relative.split('/').includes('..')) throw new IntegrityError('Unsafe transaction path');
  const resolved = path.resolve(vault.root, relative);
  if (!resolved.startsWith(path.resolve(vault.root) + path.sep)) throw new IntegrityError('Unsafe transaction path');
  return resolved;
}

async function readMaybe(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); }
  catch (error) {
    if (hasFileCode(error, 'ENOENT')) return null;
    throw error;
  }
}

async function assertSafeExistingTarget(vault: Vault, file: string): Promise<void> {
  try {
    await lstat(file);
    await vault.assertExistingPathInsideRoot(file);
  } catch (error) {
    if (!hasFileCode(error, 'ENOENT')) throw error;
  }
}

export async function plannedWrite(vault: Vault, file: string, after: string): Promise<Entry> {
  await vault.assertExistingPathInsideRoot(path.dirname(file));
  await assertSafeExistingTarget(vault, file);
  const before = await readMaybe(file);
  return { relative_path: path.relative(vault.root, file), before_hash: before === null ? null : hash(before), after };
}

export async function runTransaction(vault: Vault, changesetId: string, writes: Entry[]): Promise<void> {
  const marker = vault.transactionFile();
  if (await readMaybe(marker) !== null) throw new IntegrityError('Incomplete transaction requires recovery');
  const journal = journalSchema.parse({ changeset_id: changesetId, writes });
  await createAtomic(marker, JSON.stringify(journal) + '\n');
  await replay(vault, journal.writes);
  await rm(marker);
}

async function replay(vault: Vault, writes: Entry[]): Promise<void> {
  for (const write of writes) {
    const file = safeFile(vault, write.relative_path);
    await vault.assertExistingPathInsideRoot(path.dirname(file));
    await assertSafeExistingTarget(vault, file);
    const current = await readMaybe(file);
    if (current === write.after) continue;
    if ((current === null ? null : hash(current)) !== write.before_hash) {
      throw new IntegrityError(`Transaction file differs from both before and intended state: ${write.relative_path}`);
    }
    if (current === null) await createAtomic(file, write.after);
    else await replaceAtomic(file, write.after);
  }
}

export async function recoverTransaction(vault: Vault): Promise<boolean> {
  const source = await readMaybe(vault.transactionFile());
  if (source === null) return false;
  const journal = journalSchema.parse(JSON.parse(source));
  await replay(vault, journal.writes);
  await rm(vault.transactionFile());
  return true;
}

export async function assertNoIncompleteTransaction(vault: Vault): Promise<void> {
  if (await readMaybe(vault.transactionFile()) !== null) throw new IntegrityError('Incomplete transaction requires recovery');
}
