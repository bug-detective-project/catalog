/** Git helpers of the bd CLI: commands in a folder, archives, ticket branch refs, line endings. */
import { readTar } from '../contract/archive.ts';
import type { ArchiveFile } from '../contract/archive.ts';
import { run, runChecked } from './process.ts';

export interface Git {
  /** Runs git in the folder and returns its trimmed output; fails on a non-zero exit. */
  text(...args: string[]): Promise<string>;
}

export function gitIn(dir: string): Git {
  return {
    text: async (...args) =>
      (await runChecked('git', ['-c', 'safe.directory=*', '-C', dir, ...args])).stdout.toString('utf8').trim(),
  };
}

/** `git archive` of a ref, with line-ending conversion disabled so files keep LF on Windows. */
export async function gitArchive(dir: string, ref: string): Promise<ArchiveFile[]> {
  const { stdout } = await runChecked('git', [
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.eol=lf',
    '-c',
    'safe.directory=*',
    '-C',
    dir,
    'archive',
    '--format=tar',
    ref,
  ]);
  return readTar(stdout);
}

/** The ref of a ticket branch: the local `<id>`, or `origin/<id>` in a fresh clone or on CI. */
export async function resolveBranchRef(dir: string, branch: string): Promise<string> {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const result = await run('git', [
      '-c',
      'safe.directory=*',
      '-C',
      dir,
      'rev-parse',
      '--verify',
      '--quiet',
      `${ref}^{commit}`,
    ]);
    if (result.code === 0) {
      return ref;
    }
  }
  throw new Error(
    `${dir} has no ${branch} branch (neither local nor origin/${branch}). Run "git fetch origin" or "bd build".`,
  );
}

/**
 * Text files are normalized to LF: a Windows checkout with core.autocrlf=true has CRLF in its
 * working tree, and the package must be byte-identical on every platform (and git apply needs LF).
 */
export function normalizeLineEndings(data: Buffer): Buffer {
  return data.includes(0) || !data.includes(13) ? data : Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
}
