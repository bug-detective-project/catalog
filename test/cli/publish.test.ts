import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { publishProject, repositoryFromRemote } from '../../src/cli/publish.ts';
import { createProjectRepo } from '../helpers/project-repo.ts';
import type { ProjectRepo } from '../helpers/project-repo.ts';

let dir: string;
let repo: ProjectRepo;
const log = () => {};
const repository = 'bug-detective-project/demo';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bd-publish-'));
  repo = await createProjectRepo(dir, { front: 2, back: 1 });
  repo.git(repo.qaDir, 'checkout', '-q', '-b', 'publish/1.0.0');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const tags = (where = repo.qaDir) => repo.git(where, 'tag', '-l').split('\n').filter(Boolean).sort();
const publish = (version: string, extra: { dryRun?: boolean; push?: boolean } = {}) =>
  publishProject({ qaDir: repo.qaDir, version, repository, push: false, log, ...extra });

describe('bd publish', () => {
  it('writes the manifest, tags every ticket and commits only the manifest', async () => {
    await writeFile(join(repo.qaDir, 'notes.md'), 'draft\n');
    repo.git(repo.qaDir, 'add', 'notes.md');

    const { manifest } = await publish('1.0.0');

    expect(manifest.entries.map((entry) => entry.id)).toEqual(['front-1', 'front-2', 'back-1']);
    expect(JSON.parse(await readFile(join(repo.qaDir, 'manifest.json'), 'utf8'))).toEqual(manifest);
    expect(tags()).toEqual(['back-1-v1.0.0', 'front-1-v1.0.0', 'front-2-v1.0.0']);
    expect(repo.git(repo.qaDir, 'log', '-1', '--format=%s')).toBe('Publish Demo 1.0.0');
    expect(repo.git(repo.qaDir, 'show', '--name-only', '--format=', 'HEAD')).toBe('manifest.json');
    expect(repo.git(repo.qaDir, 'status', '--porcelain')).toBe('A  notes.md');
  });

  it('keeps the earlier tag of a ticket whose commit did not change', async () => {
    await publish('1.0.0');
    repo.git(repo.projectDir, 'checkout', '-q', 'front-2');
    await writeFile(join(repo.projectDir, 'app.txt'), 'bug front-2, again\n');
    repo.git(repo.projectDir, 'commit', '-q', '-am', 'Demo release front-2');
    repo.git(repo.projectDir, 'checkout', '-q', 'main');

    const { manifest } = await publish('1.1.0');

    expect(manifest.entries.map((entry) => entry.tag)).toEqual(['front-1-v1.0.0', 'front-2-v1.1.0', 'back-1-v1.0.0']);
  });

  it('refuses a version that is not newer, and ticket files that are not committed', async () => {
    await publish('1.0.0');
    await expect(publish('1.0.0')).rejects.toThrow(/newer/);
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'ticket.en.md'), '# edited\n');
    await expect(publish('1.1.0')).rejects.toThrow(/not committed.*tickets\/front-1\/ticket\.en\.md/s);
  });

  it('refuses to run on the qa branch', async () => {
    repo.git(repo.qaDir, 'checkout', '-q', 'qa');
    await expect(publish('1.0.0')).rejects.toThrow(/work branch/);
  });

  it('writes nothing in a dry run', async () => {
    const head = repo.git(repo.qaDir, 'rev-parse', 'HEAD');
    const { manifest } = await publish('1.0.0', { dryRun: true });
    expect(manifest.tickets.total).toBe(3);
    await expect(readFile(join(repo.qaDir, 'manifest.json'))).rejects.toThrow();
    expect(tags()).toEqual([]);
    expect(repo.git(repo.qaDir, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('pushes the ticket branches, the tags and the work branch, never qa, and links the pull request', async () => {
    const qaBefore = repo.git(repo.remoteDir, 'rev-parse', 'qa');
    repo.git(repo.projectDir, 'checkout', '-q', 'front-1');
    await writeFile(join(repo.projectDir, 'app.txt'), 'bug front-1, rebuilt\n');
    repo.git(repo.projectDir, 'commit', '-q', '--amend', '-am', 'Demo release front-1');
    repo.git(repo.projectDir, 'checkout', '-q', 'main');

    const { prUrl } = await publish('1.0.0', { push: true });

    expect(tags(repo.remoteDir)).toEqual(['back-1-v1.0.0', 'front-1-v1.0.0', 'front-2-v1.0.0']);
    expect(repo.git(repo.remoteDir, 'rev-parse', 'front-1')).toBe(repo.git(repo.qaDir, 'rev-parse', 'front-1'));
    expect(repo.git(repo.remoteDir, 'rev-parse', 'publish/1.0.0')).toBe(repo.git(repo.qaDir, 'rev-parse', 'HEAD'));
    expect(repo.git(repo.remoteDir, 'rev-parse', 'qa')).toBe(qaBefore);
    expect(prUrl).toBe('https://github.com/bug-detective-project/demo/compare/qa...publish/1.0.0?expand=1');
  });
});

describe('repositoryFromRemote', () => {
  it.each([
    ['git@github.com:bug-detective-project/supportdesk.git', 'bug-detective-project/supportdesk'],
    ['https://github.com/bug-detective-project/supportdesk.git', 'bug-detective-project/supportdesk'],
    ['https://github.com/bug-detective-project/supportdesk', 'bug-detective-project/supportdesk'],
  ])('%s → %s', (url, expected) => {
    expect(repositoryFromRemote(url)).toBe(expected);
  });

  it('refuses a remote that is not on GitHub', () => {
    expect(() => repositoryFromRemote('/tmp/remote.git')).toThrow(/GitHub/);
  });
});
