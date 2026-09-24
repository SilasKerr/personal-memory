import { open, unlink } from 'node:fs/promises';
import { VaultLockedError, hasFileCode } from '../repositories/errors.js';
import { Vault } from './vault.js';

export async function withVaultWriteLock<T>(vault: Vault, work: () => Promise<T>): Promise<T> {
  await vault.initialize();
  let handle;
  try {
    handle = await open(vault.writeLockFile(), 'wx');
  } catch (error) {
    if (hasFileCode(error, 'EEXIST')) throw new VaultLockedError();
    throw error;
  }
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
