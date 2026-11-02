/** Publishes the test project the way bd publish does, without pushing: manifest, tags and a commit on qa. */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectManifest } from '../../src/contract/manifest.ts';
import { buildManifest } from '../../src/cli/manifest.ts';
import type { ProjectRepo } from './project-repo.ts';

export async function publishLocally(repo: ProjectRepo, version: string): Promise<ProjectManifest> {
  const manifest = await buildManifest({ qaDir: repo.qaDir, version });
  await writeFile(join(repo.qaDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const entry of manifest.entries) {
    if (!repo.git(repo.qaDir, 'tag', '-l', entry.tag)) {
      repo.git(repo.qaDir, 'tag', entry.tag, entry.commit);
    }
  }
  repo.git(repo.qaDir, 'add', 'manifest.json');
  repo.git(repo.qaDir, 'commit', '-q', '-m', `Publish Demo ${version}`);
  return manifest;
}
