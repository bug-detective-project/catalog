/**
 * bd publish: writes manifest.json on a work branch of the qa folder, tags the ticket commits that
 * have no tag yet, commits the manifest and pushes the ticket branches, the tags and the work
 * branch. It never pushes qa: the publication reaches players when the pull request into qa is
 * merged, after its checks pass.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '../contract/archive.ts';
import { compareVersions } from '../contract/manifest.ts';
import type { ProjectManifest } from '../contract/manifest.ts';
import { SEMVER, buildManifest } from './manifest.ts';
import { gitIn } from './git.ts';

export interface PublishOptions {
  qaDir: string;
  version: string;
  /** owner/name on GitHub; by default, from the origin remote. */
  repository?: string;
  dryRun?: boolean;
  /** Push the ticket branches, the tags and the work branch (default true). */
  push?: boolean;
  log: (line: string) => void;
}

/** owner/name of a GitHub remote URL (SSH or HTTPS). */
export function repositoryFromRemote(url: string): string {
  const match = /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!match) {
    throw new Error(`The origin remote is not a GitHub repository: ${url}`);
  }
  return match[1];
}

export async function publishProject(options: PublishOptions): Promise<{ manifest: ProjectManifest; prUrl: string }> {
  const { qaDir, version, dryRun = false, push = true, log } = options;
  const git = gitIn(qaDir);
  if (!SEMVER.test(version)) {
    throw new Error(`Invalid version ${version}: use X.Y.Z`);
  }
  const branch = await git.text('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'qa' || branch === 'HEAD') {
    throw new Error(
      `Publish from a work branch, not from ${branch}: create one first, for example "git switch -c publish/${version}"`,
    );
  }
  const repository = options.repository ?? repositoryFromRemote(await git.text('remote', 'get-url', 'origin'));

  const published = await readFile(join(qaDir, 'manifest.json'), 'utf8').then(
    (text) => (JSON.parse(text) as { version?: string }).version,
    () => undefined,
  );
  if (published && SEMVER.test(published) && compareVersions(version, published) <= 0) {
    throw new Error(`The version must be newer than the published ${published} (got ${version})`);
  }
  if (await git.text('tag', '-l', `*-v${version}`)) {
    throw new Error(`Tags for version ${version} already exist`);
  }
  // Players download the committed tickets/, so the manifest must describe exactly those files.
  const dirty = await git.text('status', '--porcelain', '--', 'tickets');
  if (dirty) {
    throw new Error(`Commit the ticket files first; these are not committed:\n${dirty}`);
  }

  const manifest = await buildManifest({ qaDir, version });
  const prUrl = `https://github.com/${repository}/compare/qa...${branch}?expand=1`;
  if (dryRun) {
    return { manifest, prUrl };
  }

  const manifestPath = join(qaDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  for (const entry of manifest.entries) {
    if (!(await git.text('tag', '-l', entry.tag))) {
      await git.text('tag', entry.tag, entry.commit);
      log(`${entry.id}: tagged ${entry.commit.slice(0, 12)} as ${entry.tag}`);
    }
  }
  await git.text('add', 'manifest.json');
  // Only the manifest: anything else the author has staged stays staged.
  await git.text('commit', '-q', '-m', `Publish ${manifest.project.name} ${version}`, '--', 'manifest.json');
  log(`manifest.json committed on ${branch} (sha256 ${sha256Hex(await readFile(manifestPath)).slice(0, 12)})`);

  if (push) {
    const branches = manifest.entries.map((entry) => entry.branch);
    // Only this project's ticket tags: a clone may carry other tags that must not be published.
    const tags = [...new Set(manifest.entries.map((entry) => entry.tag))];
    const pushes = [
      ['push', '--force-with-lease', 'origin', ...branches],
      ['push', 'origin', ...tags],
      ['push', '--set-upstream', 'origin', branch],
    ];
    for (const [index, args] of pushes.entries()) {
      try {
        await git.text(...args);
      } catch (error) {
        // Everything local is done; re-running bd publish would refuse the same version.
        const left = pushes.slice(index).map((rest) => `  git ${rest.join(' ')}`);
        throw new Error(
          `${(error as Error).message}\n\nThe publication is committed and tagged locally. Fix the cause, then run:\n${left.join('\n')}`,
          {
            cause: error,
          },
        );
      }
    }
    log(`Pushed ${branches.join(' ')}, the tags and ${branch}`);
  }
  log(`Open the pull request into qa: ${prUrl}`);
  return { manifest, prUrl };
}
