import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abortPublication, publishProject, repositoryFromRemote } from '../../src/cli/publish.ts';
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
  it('writes the manifest and commits only it; the tags are created by the merge, not here', async () => {
    await writeFile(join(repo.qaDir, 'notes.md'), 'draft\n');
    repo.git(repo.qaDir, 'add', 'notes.md');

    const { manifest } = await publish('1.0.0');

    expect(manifest.entries.map((entry) => entry.id)).toEqual(['front-1', 'front-2', 'back-1']);
    expect(manifest.entries.map((entry) => entry.tag)).toEqual(['front-1-v1.0.0', 'front-2-v1.0.0', 'back-1-v1.0.0']);
    expect(JSON.parse(await readFile(join(repo.qaDir, 'manifest.json'), 'utf8'))).toEqual(manifest);
    expect(tags()).toEqual([]);
    expect(repo.git(repo.qaDir, 'log', '-1', '--format=%s')).toBe('Publish Demo 1.0.0');
    expect(repo.git(repo.qaDir, 'show', '--name-only', '--format=', 'HEAD')).toBe('manifest.json');
    expect(repo.git(repo.qaDir, 'status', '--porcelain')).toBe('A  notes.md');
  });

  it('keeps the earlier tag of a ticket whose commit did not change', async () => {
    const first = (await publish('1.0.0')).manifest;
    // The merge of 1.0.0 tagged its ticket commits (the project workflow's tag job).
    for (const entry of first.entries) {
      repo.git(repo.qaDir, 'tag', entry.tag, entry.commit);
    }
    repo.git(repo.projectDir, 'checkout', '-q', 'front-2');
    await writeFile(join(repo.projectDir, 'app.txt'), 'bug front-2, again\n');
    repo.git(repo.projectDir, 'commit', '-q', '-am', 'Demo release front-2');
    repo.git(repo.projectDir, 'checkout', '-q', 'main');

    const { manifest } = await publish('1.1.0');

    expect(manifest.entries.map((entry) => entry.tag)).toEqual(['front-1-v1.0.0', 'front-2-v1.1.0', 'back-1-v1.0.0']);
  });

  it('refuses a version that is not newer than the merged one, and ticket files that are not committed', async () => {
    await publish('1.0.0');
    // The pull request of 1.0.0 was merged: the next publication starts from qa.
    repo.git(repo.qaDir, 'checkout', '-q', 'qa');
    repo.git(repo.qaDir, 'merge', '-q', '--ff-only', 'publish/1.0.0');
    repo.git(repo.qaDir, 'checkout', '-q', '-b', 'publish/next');
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

  it('pushes the ticket branches and the work branch, never qa nor tags, and links the pull request', async () => {
    const qaBefore = repo.git(repo.remoteDir, 'rev-parse', 'qa');
    repo.git(repo.projectDir, 'checkout', '-q', 'front-1');
    await writeFile(join(repo.projectDir, 'app.txt'), 'bug front-1, rebuilt\n');
    repo.git(repo.projectDir, 'commit', '-q', '--amend', '-am', 'Demo release front-1');
    repo.git(repo.projectDir, 'checkout', '-q', 'main');

    const { prUrl } = await publish('1.0.0', { push: true });

    expect(tags(repo.remoteDir)).toEqual([]);
    expect(repo.git(repo.remoteDir, 'rev-parse', 'front-1')).toBe(repo.git(repo.qaDir, 'rev-parse', 'front-1'));
    expect(repo.git(repo.remoteDir, 'rev-parse', 'publish/1.0.0')).toBe(repo.git(repo.qaDir, 'rev-parse', 'HEAD'));
    expect(repo.git(repo.remoteDir, 'rev-parse', 'qa')).toBe(qaBefore);
    expect(prUrl).toBe('https://github.com/bug-detective-project/demo/compare/qa...publish/1.0.0?expand=1');
  });
});

describe('bd publish, review fixes', () => {
  it('refuses ticket files that are not tracked, such as a gate1 file bd build created', async () => {
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'gate1', 'back-2.test.txt'), 'new regression\n');
    await expect(publish('1.0.0')).rejects.toThrow(/not committed.*tickets\/front-1\/gate1\/back-2\.test\.txt/s);
  });

  it('prints the pushes that are left when one fails, so the author can finish by hand', async () => {
    // Someone else moved front-1 on origin; the lease (our origin/front-1) is now stale.
    const stale = repo.git(repo.qaDir, 'rev-parse', 'origin/front-1');
    repo.git(repo.projectDir, 'push', '-q', '--force', 'origin', 'main:front-1');
    repo.git(repo.projectDir, 'update-ref', 'refs/remotes/origin/front-1', stale);

    const error = await publish('1.0.0', { push: true }).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('git push --force-with-lease origin front-1 front-2 back-1');
    expect((error as Error).message).toContain('git push --set-upstream origin publish/1.0.0');
    expect((error as Error).message).toContain('bd publish --version 1.0.0');
  });

  it('run again after a failed push, only redoes the pushes', async () => {
    const stale = repo.git(repo.qaDir, 'rev-parse', 'origin/front-1');
    repo.git(repo.projectDir, 'push', '-q', '--force', 'origin', 'main:front-1');
    repo.git(repo.projectDir, 'update-ref', 'refs/remotes/origin/front-1', stale);
    await expect(publish('1.0.0', { push: true })).rejects.toThrow(/force-with-lease/);
    const head = repo.git(repo.qaDir, 'rev-parse', 'HEAD');
    // The cause is fixed (the lease is refreshed): the second run pushes without a new commit.
    repo.git(repo.qaDir, 'fetch', '-q', 'origin');
    const lines: string[] = [];
    const { manifest } = await publishProject({
      qaDir: repo.qaDir,
      version: '1.0.0',
      repository,
      push: true,
      log: (line) => lines.push(line),
    });
    expect(repo.git(repo.qaDir, 'rev-parse', 'HEAD')).toBe(head);
    expect(repo.git(repo.remoteDir, 'rev-parse', 'publish/1.0.0')).toBe(head);
    expect(repo.git(repo.remoteDir, 'rev-parse', 'front-1')).toBe(manifest.entries[0].commit);
    expect(lines.join('\n')).toContain('already committed');
  });

  it('refuses to resume when the tickets changed after the publication was committed', async () => {
    await publish('1.0.0');
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'ticket.en.md'), '# edited after publishing\n');
    repo.git(repo.qaDir, 'commit', '-q', '-am', 'Edit front-1');
    // HEAD is no longer the Publish commit: a new version is required.
    await expect(publish('1.0.0')).rejects.toThrow(/newer/);
    repo.git(repo.qaDir, 'reset', '-q', '--hard', 'HEAD~1');
    await writeFile(join(repo.qaDir, 'tickets', 'front-1', 'ticket.en.md'), '# edited after publishing\n');
    repo.git(repo.qaDir, 'commit', '-q', '--amend', '--no-edit', '-a');
    await expect(publish('1.0.0')).rejects.toThrow(/does not match tickets\/.*--abort/s);
  });
});

describe('bd publish --abort', () => {
  it('removes the Publish commit and restores the manifest, when nothing was pushed', async () => {
    const before = repo.git(repo.qaDir, 'rev-parse', 'HEAD');
    await publish('1.0.0');
    repo.git(repo.qaDir, 'tag', 'front-1-v1.0.0', 'front-1');
    await abortPublication({ qaDir: repo.qaDir, version: '1.0.0', log });
    expect(repo.git(repo.qaDir, 'rev-parse', 'HEAD')).toBe(before);
    expect(repo.git(repo.qaDir, 'status', '--porcelain')).toBe('');
    await expect(readFile(join(repo.qaDir, 'manifest.json'))).rejects.toThrow();
    expect(tags()).toEqual([]);
    // The next publication of the same version starts from scratch.
    expect((await publish('1.0.0')).manifest.version).toBe('1.0.0');
  });

  it('keeps the previously published manifest', async () => {
    await publish('1.0.0');
    repo.git(repo.qaDir, 'checkout', '-q', 'qa');
    repo.git(repo.qaDir, 'merge', '-q', '--ff-only', 'publish/1.0.0');
    repo.git(repo.qaDir, 'checkout', '-q', '-b', 'publish/1.1.0');
    await publish('1.1.0');
    await abortPublication({ qaDir: repo.qaDir, version: '1.1.0', log });
    expect(JSON.parse(await readFile(join(repo.qaDir, 'manifest.json'), 'utf8')).version).toBe('1.0.0');
  });

  it('refuses when HEAD is not that publication, and after the push', async () => {
    await expect(abortPublication({ qaDir: repo.qaDir, version: '1.0.0', log })).rejects.toThrow(/nothing to abort/);
    await publish('1.0.0', { push: true });
    await expect(abortPublication({ qaDir: repo.qaDir, version: '1.0.0', log })).rejects.toThrow(/already pushed/);
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
