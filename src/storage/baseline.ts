import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { semanticFingerprint } from '../domain/markdown-content.js';
import { ExternalChangePendingError, IntegrityError, hasFileCode } from '../repositories/errors.js';
import { replaceAtomic } from './atomic-file.js';
import { Vault } from './vault.js';

const schema = z.strictObject({
  id: z.string(), revision: z.number().int().positive(), fingerprint: z.string().length(64),
  created_at: z.string(), updated_at: z.string().optional(), source_commits: z.array(z.string()).optional(),
});
export type Baseline = z.infer<typeof schema>;

export function baselineFor(id: string, revision: number, content: object, createdAt: string, sourceCommits?: string[], updatedAt?: string): Baseline {
  return { id, revision, fingerprint: semanticFingerprint(content), created_at: createdAt,
    ...(updatedAt === undefined ? {} : { updated_at: updatedAt }),
    ...(sourceCommits === undefined ? {} : { source_commits: sourceCommits }) };
}

export async function readBaseline(vault: Vault, kind: 'project' | 'commit' | 'experience', id: string): Promise<Baseline> {
  const file = vault.baselineFile(kind, id);
  try {
    await vault.assertExistingPathInsideRoot(file);
    return schema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (hasFileCode(error, 'ENOENT')) throw new IntegrityError(`Missing accepted baseline for ${kind} ${id}`);
    throw error;
  }
}

export async function assertAccepted(vault: Vault, kind: 'project' | 'commit' | 'experience', id: string, revision: number, content: object, createdAt: string, sourceCommits?: string[], updatedAt?: string): Promise<Baseline> {
  const baseline = await readBaseline(vault, kind, id);
  if (baseline.id !== id || baseline.revision !== revision) throw new IntegrityError(`Damaged accepted baseline for ${kind} ${id}`);
  if (baseline.created_at !== createdAt) throw new IntegrityError(`Immutable creation time changed for ${kind} ${id}`);
  if (updatedAt !== undefined && baseline.updated_at !== updatedAt) throw new IntegrityError(`Accepted update time changed for ${kind} ${id}`);
  if (sourceCommits && sourceCommits.some((ref) => !baseline.source_commits?.includes(ref))) {
    throw new ExternalChangePendingError(kind, id);
  }
  if (sourceCommits && baseline.source_commits?.some((ref) => !sourceCommits.includes(ref))) {
    throw new ExternalChangePendingError(kind, id);
  }
  if (baseline.fingerprint !== semanticFingerprint(content)) throw new ExternalChangePendingError(kind, id);
  return baseline;
}

export async function writeBaseline(vault: Vault, kind: 'project' | 'commit' | 'experience', baseline: Baseline): Promise<void> {
  await replaceAtomic(vault.baselineFile(kind, baseline.id), JSON.stringify(schema.parse(baseline)) + '\n');
}
