/** bd catalog-check: the catalog's own check, on every pull request and every day. */
import { readFile } from 'node:fs/promises';
import { SERVICES_MIN_APP_VERSION, TICKET_TYPES_MIN_APP_VERSION, parseCatalog } from '../contract/catalog.ts';
import { compareVersions } from '../contract/manifest.ts';
import type { ProjectManifest } from '../contract/manifest.ts';
import { validateRemote } from './remote.ts';
import type { ValidateRemoteOptions } from './remote.ts';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
type Level = (typeof LEVELS)[number];

export interface CheckCatalogOptions {
  file: string;
  validate?: (options: ValidateRemoteOptions) => Promise<ProjectManifest>;
  log?: (line: string) => void;
}

/**
 * Validates projects.json, then every listed project as players download it; reports every broken
 * one. Also checks the order of the cards (the starter, then levels that never go down) and that a
 * project with ticket types other than fix asks for an app that knows them.
 */
export async function checkCatalog({
  file,
  validate = validateRemote,
  log = () => {},
}: CheckCatalogOptions): Promise<void> {
  const catalog = parseCatalog(JSON.parse(await readFile(file, 'utf8')));
  const problems: string[] = [];
  const [first] = catalog.projects;
  const starter = catalog.projects.find((project) => project.starter)!;
  if (first.id !== starter.id) {
    problems.push(`${starter.id}: the starter must be the first project`);
  }
  // After the starter, the cards go from beginner to advanced; a project without a level keeps the level before it.
  let previous: Level | undefined;
  for (const project of catalog.projects) {
    try {
      const manifest = await validate({ repository: project.repository, ref: project.qaRef, project: project.id });
      log(`${project.id}: ${manifest ? `${manifest.version}, ` : ''}valid`);
      if (!manifest) {
        continue;
      }
      const otherTypes = manifest.entries.some((entry) => entry.type !== undefined && entry.type !== 'fix');
      const supported =
        project.minAppVersion !== undefined &&
        compareVersions(project.minAppVersion, TICKET_TYPES_MIN_APP_VERSION) >= 0;
      if (otherTypes && !supported) {
        problems.push(
          `${project.id}: has tickets of other types and needs minAppVersion >= ${TICKET_TYPES_MIN_APP_VERSION}`,
        );
      }
      const declaresServices = Object.keys(manifest.project.services ?? {}).length > 0;
      const runsServices =
        project.minAppVersion !== undefined && compareVersions(project.minAppVersion, SERVICES_MIN_APP_VERSION) >= 0;
      if (declaresServices && !runsServices) {
        problems.push(`${project.id}: declares services and needs minAppVersion >= ${SERVICES_MIN_APP_VERSION}`);
      }
      const level = manifest.project.difficulty;
      if (project.starter || level === undefined) {
        continue;
      }
      if (previous !== undefined && LEVELS.indexOf(level) < LEVELS.indexOf(previous)) {
        problems.push(`${project.id}: listed out of level order (${level} after ${previous})`);
      }
      previous = level;
    } catch (error) {
      problems.push(`${project.id}: ${(error as Error).message}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}
