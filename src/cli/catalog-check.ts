/** bd catalog-check: the catalog's own check, on every pull request and every day. */
import { readFile } from 'node:fs/promises';
import { parseCatalog } from '../contract/catalog.ts';
import type { ProjectManifest } from '../contract/manifest.ts';
import { validateRemote } from './remote.ts';
import type { ValidateRemoteOptions } from './remote.ts';

export interface CheckCatalogOptions {
  file: string;
  validate?: (options: ValidateRemoteOptions) => Promise<ProjectManifest>;
  log?: (line: string) => void;
}

/** Validates projects.json, then every listed project as players download it; reports every broken one. */
export async function checkCatalog({
  file,
  validate = validateRemote,
  log = () => {},
}: CheckCatalogOptions): Promise<void> {
  const catalog = parseCatalog(JSON.parse(await readFile(file, 'utf8')));
  const problems: string[] = [];
  for (const project of catalog.projects) {
    try {
      const manifest = await validate({ repository: project.repository, ref: project.qaRef, project: project.id });
      log(`${project.id}: ${manifest ? `${manifest.version}, ` : ''}valid`);
    } catch (error) {
      problems.push(`${project.id}: ${(error as Error).message}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}
