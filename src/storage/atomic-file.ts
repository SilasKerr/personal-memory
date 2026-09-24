import { randomUUID } from 'node:crypto';
import { link, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function withTemporaryFile(file: string, contents: string, publish: (temporary: string) => Promise<void>): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, contents, { flag: 'wx' });
    await publish(temporary);
  } finally {
    await rm(temporary, { force: true });
  }
}

// Hard-link publication is atomic and refuses to replace an existing ID.
export async function createAtomic(file: string, contents: string): Promise<void> {
  await withTemporaryFile(file, contents, (temporary) => link(temporary, file));
}

export async function replaceAtomic(file: string, contents: string): Promise<void> {
  await withTemporaryFile(file, contents, (temporary) => rename(temporary, file));
}
