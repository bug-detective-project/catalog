/** Builds a project's manifest from its qa folder (a worktree of the qa branch) and its ticket branches. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;

export interface ProjectInfo {
  id: string;
  name: string;
  difficulty?: (typeof DIFFICULTIES)[number];
}

/** bugDetective.project of the qa folder's package.json. */
export async function readProject(qaDir: string): Promise<ProjectInfo> {
  let json: { bugDetective?: { project?: { id?: unknown; name?: unknown; difficulty?: unknown } } };
  try {
    json = JSON.parse(await readFile(join(qaDir, 'package.json'), 'utf8'));
  } catch {
    throw new Error(`${qaDir}/package.json is missing or is not valid JSON`);
  }
  const project = json.bugDetective?.project;
  if (typeof project?.id !== 'string' || typeof project.name !== 'string') {
    throw new Error(`${qaDir}/package.json has no bugDetective.project { id, name }`);
  }
  const { difficulty } = project;
  if (difficulty !== undefined && !DIFFICULTIES.includes(difficulty as ProjectInfo['difficulty'] & string)) {
    throw new Error(`${qaDir}/package.json: bugDetective.project.difficulty must be one of ${DIFFICULTIES.join(', ')}`);
  }
  return {
    id: project.id,
    name: project.name,
    ...(difficulty !== undefined && { difficulty: difficulty as ProjectInfo['difficulty'] }),
  };
}
