import YAML from 'yaml';
import { z } from 'zod';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseMarkdown<T>(source: string, schema: z.ZodType<T>): { metadata: T; body: string } {
  const match = FRONTMATTER.exec(source);
  if (!match) throw new Error('Markdown must begin with YAML frontmatter');
  const document = YAML.parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(`Invalid YAML frontmatter: ${document.errors[0].message}`);
  const metadata = schema.parse(document.toJS());
  return { metadata, body: source.slice(match[0].length) };
}

export function serializeMarkdown<T>(metadata: T, body: string, schema: z.ZodType<T>): string {
  const validated = schema.parse(metadata);
  return `---\n${YAML.stringify(validated).trimEnd()}\n---\n${body}`;
}
