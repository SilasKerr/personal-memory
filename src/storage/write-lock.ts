import { open, readFile, unlink } from 'node:fs/promises';
import { VaultLockedError, hasFileCode } from '../repositories/errors.js';
import { Vault } from './vault.js';

export async function withVaultWriteLock<T>(vault: Vault, work: () => Promise<T>): Promise<T> {
  await vault.initialize();
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      handle = await open(vault.writeLockFile(), 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }));
      break;
    } catch (error) {
      if (!hasFileCode(error, 'EEXIST')) throw error;
      if (attempt || !await removeAbandonedLock(vault)) throw new VaultLockedError();
    }
  }
  if (!handle) throw new VaultLockedError();
  try {
    return await work();
  } finally {
    try {
      await handle.close();
    } finally {
      await unlink(vault.writeLockFile());
    }
  }
}

async function removeAbandonedLock(vault: Vault): Promise<boolean> {
  const file = vault.writeLockFile();
  let original: string;
  try {
    await vault.assertExistingPathInsideRoot(file);
    original = await readFile(file, 'utf8');
  } catch { return false; }
  let pid: number;
  try { pid = JSON.parse(original).pid; }
  catch { return false; }
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) {
    if (!hasFileCode(error, 'ESRCH')) return false;
  }
  if (await readFile(file, 'utf8').catch(() => '') !== original) return false;
  await unlink(file);
  return true;
}
