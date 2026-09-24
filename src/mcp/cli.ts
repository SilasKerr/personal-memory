#!/usr/bin/env node
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { MemoryService } from '../services/memory-service.js';
import { Vault } from '../storage/vault.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  const root = process.env.PERSONAL_MEMORY_VAULT;
  if (!root || !path.isAbsolute(root)) throw new Error('PERSONAL_MEMORY_VAULT must be an absolute path to an initialized Vault');
  const vault = new Vault(root);
  await vault.validateExisting();
  const server = createMcpServer(new MemoryService(vault));
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
