import { createHash } from 'node:crypto';
import {
  commitContentSchema, experienceContentSchema, projectContentSchema,
  type CommitContent, type ExperienceContent, type ProjectContent,
} from './schemas.js';

type Fields = Record<string, string | string[] | undefined>;
type Layout = Array<[string, string, 'text' | 'list']>;
const projectLayout: Layout = [
  ['goal', 'Goal', 'text'], ['current_state', 'Current State', 'text'],
  ['confirmed_decisions', 'Confirmed Decisions', 'list'], ['open_questions', 'Open Questions', 'list'],
  ['next_steps', 'Next Steps', 'list'], ['lifecycle', 'Lifecycle', 'text'],
];
const commitLayout: Layout = [
  ['stage_goal', 'Stage Goal', 'text'], ['starting_point', 'Starting Point', 'text'],
  ['key_findings', 'Key Findings', 'list'], ['turning_points', 'Turning Points', 'list'],
  ['decisions', 'Decisions', 'list'], ['rejected_approaches', 'Rejected Approaches', 'list'],
  ['ending_state', 'Ending State', 'text'], ['open_questions', 'Open Questions', 'list'],
  ['next_steps', 'Next Steps', 'list'],
];
const experienceLayout: Layout = [
  ['core_statement', 'Core Statement', 'text'], ['context', 'Context', 'text'],
  ['evidence', 'Evidence', 'text'], ['applies_when', 'Applies When', 'text'],
  ['limitations', 'Limitations', 'text'], ['recommended_action', 'Recommended Action', 'text'],
  ['maturity', 'Maturity', 'text'],
];

function normalizedText(value: string): string {
  return value.replace(/\r\n/g, '\n').split('\n').map((line) => line.trim()).join('\n').trim();
}

function render(title: string, content: Fields, layout: Layout): string {
  const lines = [`# ${normalizedText(title)}`];
  for (const [field, label, kind] of layout) {
    const value = content[field];
    if (value === undefined || (Array.isArray(value) && !value.length)) continue;
    lines.push('', `## ${label}`, '');
    if (kind === 'list') lines.push(...(value as string[]).map((item) => `- ${normalizedText(item)}`));
    else lines.push(normalizedText(value as string).replace(/^#/gm, '\\#'));
  }
  return lines.join('\n') + '\n';
}

function parse(body: string, layout: Layout): { title: string; fields: Fields } {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first < 0 || !/^#\s+\S/.test(lines[first])) throw new Error('Missing Markdown title');
  const title = lines[first].replace(/^#\s+/, '').trim();
  const labels = new Map(layout.map(([field, label, kind]) => [label, { field, kind }]));
  const fields: Fields = {};
  const seen = new Set<string>();
  let current: { field: string; kind: 'text' | 'list' } | null = null;
  let bucket: string[] = [];
  function flush(): void {
    if (!current) return;
    const values = bucket.filter((line) => line.trim() !== '');
    if (current.kind === 'list') {
      if (values.some((line) => !/^\s*-\s+\S/.test(line))) throw new Error(`Invalid list: ${current.field}`);
      fields[current.field] = values.map((line) => line.replace(/^\s*-\s+/, '').trim());
    } else if (values.length) fields[current.field] = normalizedText(bucket.join('\n')).replace(/^\\#/gm, '#');
    bucket = [];
  }
  for (const line of lines.slice(first + 1)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const match = labels.get(heading[1]);
      if (!match) throw new Error(`Unknown section: ${heading[1]}`);
      if (seen.has(match.field)) throw new Error(`Duplicate section: ${heading[1]}`);
      seen.add(match.field);
      current = match;
    } else if (current) bucket.push(line);
    else if (line.trim()) throw new Error('Content before first section');
  }
  flush();
  return { title, fields };
}

export function renderProject(content: ProjectContent): string {
  return render(content.name, content as Fields, projectLayout);
}
export function parseProject(body: string): ProjectContent {
  const parsed = parse(body, projectLayout);
  return projectContentSchema.parse({
    confirmed_decisions: [], open_questions: [], next_steps: [],
    name: parsed.title, ...parsed.fields,
  });
}
export function renderCommit(content: CommitContent): string {
  return render(content.title, content as Fields, commitLayout);
}
export function parseCommit(body: string): CommitContent {
  const parsed = parse(body, commitLayout);
  return commitContentSchema.parse({ title: parsed.title, ...parsed.fields });
}
export function renderExperience(content: ExperienceContent): string {
  return render(content.title, content as Fields, experienceLayout);
}
export function parseExperience(body: string): ExperienceContent {
  const parsed = parse(body, experienceLayout);
  return experienceContentSchema.parse({ title: parsed.title, ...parsed.fields });
}

export function semanticFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
