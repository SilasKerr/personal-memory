// Opt-in bodies for new documents. Repositories never rewrite an existing body.
export function defaultProjectBody(name: string): string {
  return `# ${name}\n\n## Goal\n\n\n## Current State\n\n\n## Confirmed Decisions\n\n\n## Open Questions\n\n\n## Next Steps\n\n\n## Recent Changes\n\n`;
}

export function defaultCommitBody(title: string): string {
  return `# ${title}\n\n## Stage Goal\n\n\n## Starting Point\n\n\n## Key Findings\n\n\n## Decisions\n\n\n## Rejected Approaches\n\n\n## Current State\n\n\n## Open Questions\n\n\n## Next Step\n\n`;
}

export function defaultExperienceBody(title: string): string {
  return `# ${title}\n\n\n## Why\n\n\n## Applies When\n\n\n## Evidence\n\n\n## Limitations\n\n`;
}
