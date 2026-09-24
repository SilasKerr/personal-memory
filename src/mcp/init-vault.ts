#!/usr/bin/env node
import path from 'node:path';
import { Vault } from '../storage/vault.js';

const root = process.env.PERSONAL_MEMORY_VAULT;
if (!root || !path.isAbsolute(root)) {
  console.error('PERSONAL_MEMORY_VAULT must be an absolute path');
  process.exitCode = 1;
} else {
  new Vault(root).initialize().then(
    () => console.log(`Initialized Personal Memory Vault: ${root}`),
    (error: unknown) => { console.error(error); process.exitCode = 1; },
  );
}
