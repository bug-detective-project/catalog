import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpError, fetchZipWithTimeout, validateRemote } from '../../src/cli/remote.ts';
import { publishLocally } from '../helpers/publication.ts';
import { createProjectRepo } from '../helpers/project-repo.ts';
import type { ProjectRepo } from '../helpers/project-repo.ts';

let dir: string;
let repo: ProjectRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bd-remote-'));
  repo = await createProjectRepo(dir, { front: 2, back: 1 });
  await publishLocally(repo, '1.0.0');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** GitHub's archive URLs, served from the local repository (zips with a top folder, like GitHub's). */
const fetchZip = async (url: string): Promise<Uint8Array> => {
  const match = /^https:\/\/github\.com\/bug-detective-project\/demo\/archive\/(?:refs\/heads\/)?(.+)\.zip$/.exec(url);
  const ref = match?.[1];
  const exists =
    ref &&
    execFileSync('git', ['-C', repo.qaDir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      encoding: 'utf8',
    }).trim();
  if (!exists) throw new HttpError(url, 404);
  return execFileSync('git', ['-C', repo.qaDir, 'archive', '--format=zip', `--prefix=demo-${ref}/`, ref]);
};

/** git ls-remote --tags of the local repository. */
const lsRemoteTags = async () =>
  new Map(
    repo
      .git(repo.qaDir, 'show-ref', '--tags')
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' '))
      .map(([commit, ref]) => [ref.replace('refs/tags/', ''), commit] as [string, string]),
  );

const validate = () =>
  validateRemote({ repository: 'bug-detective-project/demo', project: 'demo', fetchZip, lsRemoteTags });

describe('bd validate --remote', () => {
  it('accepts a published project, checking each ticket by its tag', async () => {
    expect((await validate()).version).toBe('1.0.0');
  });

  it('does not look at the ticket branch tips, which may be ahead during a pull request', async () => {
    repo.git(repo.projectDir, 'checkout', '-q', 'front-1');
    await writeFile(join(repo.projectDir, 'app.txt'), 'bug front-1, rebuilt\n');
    repo.git(repo.projectDir, 'commit', '-q', '-am', 'Demo release front-1');
    repo.git(repo.projectDir, 'checkout', '-q', 'main');
    expect((await validate()).version).toBe('1.0.0');
  });

  it('refuses a tag that points to another commit, naming the ticket and the tag', async () => {
    repo.git(repo.qaDir, 'tag', '-f', 'front-2-v1.0.0', 'main');
    await expect(validate()).rejects.toThrow(/front-2.*front-2-v1\.0\.0/);
  });

  it('refuses a tag that was not pushed', async () => {
    repo.git(repo.qaDir, 'tag', '-d', 'back-1-v1.0.0');
    await expect(validate()).rejects.toThrow(/back-1.*is not published/);
  });

  it('refuses code that does not match the manifest, naming the ticket', async () => {
    const front1 = repo.git(repo.qaDir, 'rev-parse', 'front-1');
    // The commit archive of front-1 serves main's code instead.
    const tampered = (url: string) => fetchZip(url.endsWith(`/${front1}.zip`) ? url.replace(front1, 'main') : url);
    await expect(
      validateRemote({ repository: 'bug-detective-project/demo', project: 'demo', fetchZip: tampered, lsRemoteTags }),
    ).rejects.toThrow(/front-1.*code/);
  });

  it('refuses a manifest of another project', async () => {
    await expect(
      validateRemote({ repository: 'bug-detective-project/demo', project: 'other', fetchZip, lsRemoteTags }),
    ).rejects.toThrow(/another project/);
  });
});

describe('fetchZipWithTimeout', () => {
  it('gives up on a server that never answers', async () => {
    const server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(fetchZipWithTimeout(100)(`http://127.0.0.1:${port}/a.zip`)).rejects.toThrow(/did not answer within/);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
