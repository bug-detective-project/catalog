import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { treeDigest } from '../../src/contract/archive.ts';
import { gitArchive } from '../../src/cli/git.ts';
import { buildManifest } from '../../src/cli/manifest.ts';
import { createProjectRepo } from '../helpers/project-repo.ts';
import type { ProjectRepo } from '../helpers/project-repo.ts';

let dir: string;
let repo: ProjectRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bd-manifest-'));
  repo = await createProjectRepo(dir, { front: 2, back: 1 });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const build = () => buildManifest({ qaDir: repo.qaDir, version: '1.0.0' });

describe('buildManifest', () => {
  it('describes every ticket: its branch commit, code and package', async () => {
    const manifest = await build();
    expect(manifest.project).toEqual({ id: 'demo', name: 'Demo' });
    expect(manifest.tickets).toEqual({ total: 3, front: 2, back: 1 });
    expect(manifest.entries.map((entry) => entry.id)).toEqual(['front-1', 'front-2', 'back-1']);
    expect(manifest.entries[0].commit).toBe(repo.git(repo.qaDir, 'rev-parse', 'front-1'));
    expect(manifest.entries[0].tag).toBe('front-1-v1.0.0');
    expect(manifest.entries[0].commitMessage).toBe('Demo release front-1');
    expect(manifest.entries[0].package).toMatchObject({ path: 'tickets/front-1', files: 11 });
  });

  it('refuses a ticket without a required file', async () => {
    repo.git(repo.qaDir, 'rm', '-q', 'tickets/front-2/reference.patch');
    repo.git(repo.qaDir, 'commit', '-q', '-m', 'Drop the patch');
    await expect(build()).rejects.toThrow(/front-2.*reference\.patch/);
  });

  it('refuses a ticket without a branch, local or on origin', async () => {
    repo.git(repo.projectDir, 'branch', '-q', '-D', 'back-1');
    repo.git(repo.projectDir, 'update-ref', '-d', 'refs/remotes/origin/back-1');
    await expect(build()).rejects.toThrow(/back-1/);
  });

  it('uses origin/<id> when there is no local ticket branch', async () => {
    const commit = repo.git(repo.qaDir, 'rev-parse', 'back-1');
    repo.git(repo.projectDir, 'branch', '-q', '-D', 'back-1');
    expect((await build()).entries[2].commit).toBe(commit);
  });

  it('refuses a ticket folder with an invalid name', async () => {
    repo.git(repo.qaDir, 'mv', 'tickets/front-2', 'tickets/front-02');
    repo.git(repo.qaDir, 'commit', '-q', '-m', 'Rename');
    await expect(build()).rejects.toThrow(/front-02/);
  });

  it('ignores files that are not committed in a ticket folder', async () => {
    const before = (await build()).entries[0].package;
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'notes.tmp'), 'scratch\n');
    expect((await build()).entries[0].package).toEqual(before);
  });

  it('gives the same digest for CRLF files on disk as for LF files', async () => {
    const before = (await build()).entries[0].package.digest;
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'ticket.en.md'), '# front-1\r\n');
    expect((await build()).entries[0].package.digest).toBe(before);
  });

  it('refuses a qa branch without its story or with an invalid review configuration', async () => {
    repo.git(repo.qaDir, 'rm', '-q', 'story.pt.json');
    repo.git(repo.qaDir, 'commit', '-q', '-m', 'Drop the story');
    await expect(build()).rejects.toThrow(/story\.pt\.json/);
    repo.git(repo.qaDir, 'checkout', '-q', 'HEAD~1', '--', 'story.pt.json');
    await writeFile(join(repo.qaDir, 'review.json'), '{ "exclude": "not a list" }\n');
    repo.git(repo.qaDir, 'add', '-A');
    repo.git(repo.qaDir, 'commit', '-q', '-m', 'Bad review');
    await expect(build()).rejects.toThrow(/review/);
  });

  it('copies the project difficulty into the manifest, and refuses an unknown one', async () => {
    const write = async (difficulty: string) => {
      const file = join(repo.qaDir, 'package.json');
      const json = JSON.parse(await readFile(file, 'utf8'));
      json.bugDetective.project.difficulty = difficulty;
      await writeFile(file, JSON.stringify(json));
    };
    await write('intermediate');
    expect((await build()).project.difficulty).toBe('intermediate');
    await write('hard');
    await expect(build()).rejects.toThrow(/difficulty/);
  });

  it('refuses an invalid version and a qa folder without package.json', async () => {
    await expect(buildManifest({ qaDir: repo.qaDir, version: '1.0' })).rejects.toThrow(/X\.Y\.Z/);
    await unlink(join(repo.qaDir, 'package.json'));
    await expect(build()).rejects.toThrow(/package\.json/);
  });

  it('digests the committed files, as GitHub serves them, even when they have CRLF line endings', async () => {
    repo.git(repo.qaDir, 'config', 'core.autocrlf', 'false');
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'ticket.en.md'), '# front-1\r\n');
    repo.git(repo.qaDir, 'commit', '-q', '-am', 'CRLF card');
    const blob = Buffer.from(repo.git(repo.qaDir, 'cat-file', '-p', 'HEAD:tickets/front-1/ticket.en.md') + '\n');
    const files = await gitArchive(repo.qaDir, 'HEAD');
    const committed = files
      .filter((file) => file.path.startsWith('tickets/front-1/') && !file.path.endsWith('bug.patch'))
      .map((file) => ({ ...file, path: file.path.slice('tickets/front-1/'.length) }));
    expect(committed.find((file) => file.path === 'ticket.en.md')!.data.includes(13)).toBe(true);
    expect((await build()).entries[0].package.digest).toBe(treeDigest(committed));
    expect(blob.length).toBeGreaterThan(0);
  });

  it('copies bugDetective.project.stack into the manifest', async () => {
    const stack = { frontend: 'React · Vite', database: 'SQLite' };
    const pkg = JSON.parse(await readFile(join(repo.qaDir, 'package.json'), 'utf8'));
    pkg.bugDetective.project.stack = stack;
    await writeFile(join(repo.qaDir, 'package.json'), JSON.stringify(pkg));
    expect((await build()).project.stack).toEqual(stack);
  });

  it('has no stack when package.json gives none', async () => {
    expect((await build()).project).not.toHaveProperty('stack');
  });

  it('refuses an unknown stack key', async () => {
    const pkg = JSON.parse(await readFile(join(repo.qaDir, 'package.json'), 'utf8'));
    pkg.bugDetective.project.stack = { mobile: 'Swift' };
    await writeFile(join(repo.qaDir, 'package.json'), JSON.stringify(pkg));
    await expect(build()).rejects.toThrow(/bugDetective\.project\.stack/);
  });
});
