/**
 * bd validate: checks the qa folder before its pull request is merged. The committed
 * manifest.json must describe exactly the committed tickets, the ticket branches and their tags,
 * and its version must be newer than the published one.
 */
import { compareVersions, parseManifest } from '../contract/manifest.ts';
import { textProblems, vscodeProblems } from '../contract/policy.ts';
import type { TextFile } from '../contract/policy.ts';
import type { ProjectManifest, TicketEntry } from '../contract/manifest.ts';
import { buildManifest, readQaFiles } from './manifest.ts';
import {
  fetchJsonWithTimeout,
  installScriptProblems,
  lockfileOriginProblems,
  npmrcProblems,
  releaseAgeProblems,
} from './dependencies.ts';
import type { FetchJson, Lockfile, PackageJson } from './dependencies.ts';
import { gitArchive, gitIn, resolveBranchRef } from './git.ts';
import { run } from './process.ts';

export interface ValidateLocalOptions {
  qaDir: string;
  /** Where the published manifest is: the base branch of the pull request. */
  baseRef?: string;
  /** Skip the checks that need the network (the release ages of the dependencies). */
  offline?: boolean;
  fetchJson?: FetchJson;
  log?: (line: string) => void;
}

/** The manifest.json committed at a ref, or undefined when the ref or the file does not exist. */
async function manifestAt(qaDir: string, ref: string): Promise<unknown> {
  const result = await run('git', ['-c', 'safe.directory=*', '-C', qaDir, 'show', `${ref}:manifest.json`]);
  return result.code === 0 ? JSON.parse(result.stdout.toString('utf8')) : undefined;
}

/** The fields of an entry that differ from what the ticket branch and folder give. */
function differences(published: TicketEntry, rebuilt: TicketEntry): string[] {
  return (Object.keys(rebuilt) as (keyof TicketEntry)[]).filter(
    (key) => JSON.stringify(published[key]) !== JSON.stringify(rebuilt[key]),
  );
}

/** A committed file of the qa folder, or undefined when it is not there. */
async function fileAt(qaDir: string, ref: string, path: string): Promise<string | undefined> {
  const result = await run('git', ['-c', 'safe.directory=*', '-C', qaDir, 'show', `${ref}:${path}`]);
  return result.code === 0 ? result.stdout.toString('utf8') : undefined;
}

const WORKFLOW_USES =
  /uses:\s*["']?bug-detective-project\/catalog\/\.github\/workflows\/project\.yml@([^\s"'#]+)["']?(?:\s*#\s*(v\d+\.\d+\.\d+))?/;

/**
 * The project workflow must call this repository's project.yml pinned by commit hash, with the
 * version in a comment that matches the @bug-detective/catalog dependency of the qa branch: the
 * checks and the CLI then come from the same version.
 */
export async function workflowReferenceProblems(qaDir: string, ref = 'HEAD'): Promise<string[]> {
  const workflow = await fileAt(qaDir, ref, '.github/workflows/publication.yml');
  if (workflow === undefined) {
    return [];
  }
  const match = WORKFLOW_USES.exec(workflow);
  if (!match) {
    return [
      '.github/workflows/publication.yml does not call bug-detective-project/catalog/.github/workflows/project.yml',
    ];
  }
  const [, pinned, comment] = match;
  const problems: string[] = [];
  if (!/^[0-9a-f]{40}$/.test(pinned)) {
    problems.push(
      `.github/workflows/publication.yml must pin project.yml by commit hash (uses: ...project.yml@<40 hex> # vX.Y.Z), not "@${pinned}"`,
    );
  }
  const packageJson = await fileAt(qaDir, ref, 'package.json');
  const spec = packageJson
    ? ((JSON.parse(packageJson) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> })
        .dependencies?.['@bug-detective/catalog'] ??
      (JSON.parse(packageJson) as { devDependencies?: Record<string, string> }).devDependencies?.[
        '@bug-detective/catalog'
      ])
    : undefined;
  const dependency = /#(v\d+\.\d+\.\d+)$/.exec(spec ?? '')?.[1];
  if (!comment) {
    problems.push(
      '.github/workflows/publication.yml must say which version the hash is: uses: ...project.yml@<hash> # vX.Y.Z',
    );
  } else if (dependency && comment !== dependency) {
    problems.push(
      `.github/workflows/publication.yml calls project.yml ${comment}, but package.json depends on @bug-detective/catalog ${dependency}: use the same version in both`,
    );
  }
  return problems;
}

const TEXT_FILE = /^tickets\/[^/]+\/(?:ticket|solution|review)\.(?:en|pt)\.md$/;
const HINTS_FILE = /^tickets\/[^/]+\/hints\.(?:en|pt)\.json$/;
const STORY_FILE = /^story\.(?:en|pt)\.json$/;

const decoder = new TextDecoder();

/** Every string of a JSON value, one per line, so a match can name its position. */
function jsonStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(jsonStrings);
  return [];
}

/** The player-facing texts of the committed qa folder: markdown as is, JSON as its strings. */
export async function projectTexts(qaDir: string): Promise<TextFile[]> {
  const texts: TextFile[] = [];
  for (const file of await readQaFiles(qaDir)) {
    const text = decoder.decode(file.data);
    if (TEXT_FILE.test(file.path)) {
      texts.push({ path: file.path, text });
    } else if (HINTS_FILE.test(file.path) || STORY_FILE.test(file.path)) {
      try {
        texts.push({ path: file.path, text: jsonStrings(JSON.parse(text)).join('\n') });
      } catch {
        // An invalid JSON file is reported by the schema checks, not here.
      }
    }
  }
  return texts;
}

/** The .vscode/ files of main and of every ticket branch, per branch. */
export async function vscodeFilesOf(
  qaDir: string,
  branches: readonly string[],
): Promise<{ branch: string; files: TextFile[] }[]> {
  const result: { branch: string; files: TextFile[] }[] = [];
  for (const branch of ['main', ...branches]) {
    const ref = await resolveBranchRef(qaDir, branch).catch(() => null);
    if (!ref) continue;
    const files = (await gitArchive(qaDir, ref))
      .filter((file) => file.path.startsWith('.vscode/'))
      .map((file) => ({ path: file.path, text: decoder.decode(file.data) }));
    result.push({ branch, files });
  }
  return result;
}

/** The policy checks of a publication: VS Code files and extensions, and dangerous commands in the texts. */
export async function policyProblems(qaDir: string, branches: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const { branch, files } of await vscodeFilesOf(qaDir, branches)) {
    problems.push(...vscodeProblems(files).map((problem) => `${branch}: ${problem}`));
  }
  return [...problems, ...textProblems(await projectTexts(qaDir))];
}

/**
 * The dependency checks of main and of every ticket branch: origins and integrity, allowed
 * install scripts, the .npmrc, and (with the network) the release ages. A branch without a
 * lockfile has no dependencies and nothing to check.
 */
export async function dependencyProblems(
  qaDir: string,
  branches: readonly string[],
  options: { offline?: boolean; fetchJson?: FetchJson; log?: (line: string) => void } = {},
): Promise<string[]> {
  const problems: string[] = [];
  const log = options.log ?? (() => {});
  for (const branch of ['main', ...branches]) {
    const ref = await resolveBranchRef(qaDir, branch).catch(() => null);
    if (!ref) continue;
    const lockText = await fileAt(qaDir, ref, 'package-lock.json');
    if (lockText === undefined) continue;
    let lock: Lockfile;
    let packageJson: PackageJson;
    try {
      lock = JSON.parse(lockText) as Lockfile;
      packageJson = JSON.parse((await fileAt(qaDir, ref, 'package.json')) ?? '{}') as PackageJson;
    } catch (error) {
      problems.push(`${branch}: package.json or package-lock.json is not valid JSON (${(error as Error).message})`);
      continue;
    }
    const found = [
      ...lockfileOriginProblems(lock),
      ...installScriptProblems(lock, packageJson),
      ...npmrcProblems(await fileAt(qaDir, ref, '.npmrc')),
      ...(options.offline
        ? []
        : await releaseAgeProblems(lock, options.fetchJson ?? fetchJsonWithTimeout, new Date(), log)),
    ];
    problems.push(...found.map((problem) => `${branch}: ${problem}`));
  }
  return problems;
}

export async function validateLocal({
  qaDir,
  baseRef = 'origin/qa',
  offline = false,
  fetchJson,
  log,
}: ValidateLocalOptions): Promise<ProjectManifest> {
  const git = gitIn(qaDir);
  const problems: string[] = [];

  const dirty = await git.text('status', '--porcelain', '--', 'tickets');
  if (dirty) {
    problems.push(`These ticket files are not committed (players only get committed files):\n${dirty}`);
  }
  problems.push(...(await workflowReferenceProblems(qaDir)));

  const raw = await manifestAt(qaDir, 'HEAD');
  if (raw === undefined) {
    throw new Error('The qa branch has no committed manifest.json: run bd publish first');
  }
  const manifest = parseManifest(raw);

  try {
    const rebuilt = await buildManifest({ qaDir, version: manifest.version, now: manifest.createdAt });
    if (
      rebuilt.project.id !== manifest.project.id ||
      JSON.stringify(rebuilt.tickets) !== JSON.stringify(manifest.tickets)
    ) {
      problems.push('manifest.json does not list the tickets of tickets/: run bd publish again');
    }
    for (const entry of manifest.entries) {
      const fresh = rebuilt.entries.find((item) => item.id === entry.id);
      const changed = fresh ? differences(entry, fresh) : [];
      if (changed.length > 0) {
        problems.push(`${entry.id}: manifest.json does not match the ticket (${changed.join(', ')})`);
      }
    }
  } catch (error) {
    problems.push((error as Error).message);
  }

  problems.push(
    ...(await policyProblems(
      qaDir,
      manifest.entries.map((entry) => entry.branch),
    )),
    ...(await dependencyProblems(
      qaDir,
      manifest.entries.map((entry) => entry.branch),
      { offline, fetchJson, log },
    )),
  );

  for (const entry of manifest.entries) {
    const tagged = await run('git', [
      '-c',
      'safe.directory=*',
      '-C',
      qaDir,
      'rev-parse',
      '--verify',
      '--quiet',
      `refs/tags/${entry.tag}^{commit}`,
    ]);
    const commit = tagged.stdout.toString('utf8').trim();
    if (tagged.code !== 0) {
      // Tags are created when the pull request is merged: before that, the commit must be the
      // ticket branch (locally or on origin).
      const onBranch = await run('git', [
        '-c',
        'safe.directory=*',
        '-C',
        qaDir,
        'branch',
        '-a',
        '--contains',
        entry.commit,
      ]);
      const branches = onBranch.stdout
        .toString('utf8')
        .split('\n')
        .map((line) => line.replace(/^\*?\s*/, '').replace(/^remotes\/origin\//, ''))
        .filter(Boolean);
      if (onBranch.code !== 0 || !branches.includes(entry.branch)) {
        problems.push(
          `${entry.id}: the tag ${entry.tag} does not exist and ${entry.commit.slice(0, 12)} is not on the branch ${entry.branch}`,
        );
      }
    } else if (commit !== entry.commit) {
      problems.push(
        `${entry.id}: the tag ${entry.tag} points to ${commit.slice(0, 12)}, not to the manifest's ${entry.commit.slice(0, 12)}`,
      );
    }
  }

  const baseExists = await run('git', [
    '-c',
    'safe.directory=*',
    '-C',
    qaDir,
    'rev-parse',
    '--verify',
    '--quiet',
    `${baseRef}^{commit}`,
  ]);
  if (baseExists.code !== 0) {
    throw new Error(`The base ref ${baseRef} does not exist: fetch it ("git fetch origin") or pass --base-ref`);
  }
  const base = await manifestAt(qaDir, baseRef);
  if (base !== undefined) {
    const published = (base as { version?: unknown }).version;
    if (typeof published === 'string' && compareVersions(manifest.version, published) <= 0) {
      // Housekeeping on qa (README, workflows, CODEOWNERS, .npmrc) is not a publication: the same
      // version is fine while the manifest and the tickets are exactly the published ones.
      const sameManifest = JSON.stringify(base) === JSON.stringify(raw);
      const ticketsDiff = await run('git', [
        '-c',
        'safe.directory=*',
        '-C',
        qaDir,
        'diff',
        '--quiet',
        baseRef,
        'HEAD',
        '--',
        'tickets',
      ]);
      if (!(sameManifest && ticketsDiff.code === 0)) {
        problems.push(`The version ${manifest.version} must be newer than ${published}, published on ${baseRef}`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
  return manifest;
}
