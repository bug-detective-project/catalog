/**
 * bd validate --remote: checks a project as players download it from GitHub. Each ticket is checked
 * through its tag (<id>-v<version>), which keeps the published commit reachable; the ticket branch
 * tip is never used, because bd publish moves it before the qa pull request is merged.
 */
import { fileText, readZip } from '../contract/archive.ts';
import { parseManifest } from '../contract/manifest.ts';
import type { ProjectManifest } from '../contract/manifest.ts';
import { projectContentOf } from '../contract/project-files.ts';
import { packageOf, verifyCode, verifyPackage } from '../contract/verify.ts';
import { runChecked } from './process.ts';

const GITHUB = 'https://github.com';

export class HttpError extends Error {
  readonly status: number;

  constructor(url: string, status: number) {
    super(`${url} answered ${status}`);
    this.status = status;
  }
}

export type FetchZip = (url: string) => Promise<Uint8Array>;
export type LsRemoteTags = (repository: string) => Promise<Map<string, string>>;

export interface ValidateRemoteOptions {
  /** owner/name on GitHub. */
  repository: string;
  /** The branch or tag the content comes from. */
  ref?: string;
  /** The project id the manifest must have. */
  project?: string;
  fetchZip?: FetchZip;
  lsRemoteTags?: LsRemoteTags;
}

/** Downloads a zip, giving up after timeoutMs (a stalled download must not hang the daily check). */
export function fetchZipWithTimeout(timeoutMs: number): FetchZip {
  return async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        throw new HttpError(url, response.status);
      }
      return new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new Error(`${url} did not answer within ${timeoutMs / 1000} s`, { cause: error });
      }
      throw error;
    }
  };
}

export const fetchZipFromGitHub: FetchZip = fetchZipWithTimeout(120_000);

/** The tags of a public repository and the commit each one points to (annotated tags peeled). */
export const lsRemoteTagsFromGitHub: LsRemoteTags = async (repository) => {
  const { stdout } = await runChecked('git', ['ls-remote', '--tags', `${GITHUB}/${repository}.git`]);
  const tags = new Map<string, string>();
  for (const line of stdout.toString('utf8').split('\n').filter(Boolean)) {
    const [commit, ref] = line.split('\t');
    const name = ref.replace('refs/tags/', '');
    if (name.endsWith('^{}')) {
      tags.set(name.slice(0, -3), commit);
    } else if (!tags.has(name)) {
      tags.set(name, commit);
    }
  }
  return tags;
};

/** The archive of a branch, or of a tag when no branch has that name. */
async function refZip(repository: string, ref: string, fetchZip: FetchZip): Promise<Uint8Array> {
  try {
    return await fetchZip(`${GITHUB}/${repository}/archive/refs/heads/${encodeURIComponent(ref)}.zip`);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
    return fetchZip(`${GITHUB}/${repository}/archive/refs/tags/${encodeURIComponent(ref)}.zip`);
  }
}

export async function validateRemote({
  repository,
  ref = 'qa',
  project,
  fetchZip = fetchZipFromGitHub,
  lsRemoteTags = lsRemoteTagsFromGitHub,
}: ValidateRemoteOptions): Promise<ProjectManifest> {
  const qaFiles = readZip(await refZip(repository, ref, fetchZip), { stripTopDirectory: true });
  const manifestFile = qaFiles.find((file) => file.path === 'manifest.json');
  if (!manifestFile) {
    throw new Error(`${repository}@${ref} has no manifest.json`);
  }
  const manifest = parseManifest(JSON.parse(fileText(manifestFile)), project);
  projectContentOf(qaFiles.filter((file) => !file.path.startsWith('tickets/')));

  const problems: string[] = [];
  const tags = await lsRemoteTags(repository);
  for (const entry of manifest.entries) {
    try {
      verifyPackage(entry, packageOf(entry, qaFiles));
    } catch (error) {
      problems.push((error as Error).message);
    }
    const tagged = tags.get(entry.tag);
    if (tagged === undefined) {
      problems.push(`${entry.id}: the tag ${entry.tag} is not published`);
      continue;
    }
    if (tagged !== entry.commit) {
      problems.push(
        `${entry.id}: the tag ${entry.tag} points to ${tagged.slice(0, 12)}, not to the manifest's ${entry.commit.slice(0, 12)}`,
      );
      continue;
    }
    try {
      verifyCode(
        entry,
        readZip(await fetchZip(`${GITHUB}/${repository}/archive/${entry.commit}.zip`), { stripTopDirectory: true }),
      );
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  if (problems.length > 0) {
    throw new Error(`${repository}@${ref} (${manifest.version}):\n${problems.join('\n')}`);
  }
  return manifest;
}
