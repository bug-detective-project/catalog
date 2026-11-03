import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateLocal, workflowReferenceProblems } from '../../src/cli/validate.ts';
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
