import { readFile, readdir, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildTickets } from '../../src/cli/build.ts';
import { useRealPatches } from '../helpers/patches.ts';
import { createProjectRepo } from '../helpers/project-repo.ts';
import type { ProjectRepo } from '../helpers/project-repo.ts';

let dir: string;
let repo: ProjectRepo;
const ids = ['front-1', 'front-2', 'back-1'];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bd-build-'));
  repo = await createProjectRepo(dir, { front: 2, back: 1 });
  await useRealPatches(repo, ids);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const gate1 = async (id: string) =>
  (await readdir(join(repo.qaDir, 'tickets', id, 'gate1'), { recursive: true })).sort();

describe('bd build', () => {
  it("writes each gate1 from main's tests and the other tickets' regression tests", async () => {
    await buildTickets({ qaDir: repo.qaDir, log: () => {} });

    expect(await gate1('front-2')).toEqual(['app.test.txt', 'back-1.test.txt', 'front-1.test.txt']);
    expect(await gate1('front-1')).toEqual(['app.test.txt', 'back-1.test.txt', 'front-2.test.txt']);
    expect(await readFile(join(repo.qaDir, 'tickets', 'front-2', 'gate1', 'front-1.test.txt'), 'utf8')).toBe(
      'regression front-1\n',
    );
  });

  it('rebuilds each ticket branch as one commit with the bug, gate1 and the Jira card', async () => {
    await buildTickets({ qaDir: repo.qaDir, log: () => {} });

    expect(repo.git(repo.qaDir, 'rev-list', '--count', 'front-2')).toBe('1');
    expect(repo.git(repo.qaDir, 'log', '-1', '--format=%s', 'front-2')).toBe('Demo release front-2');
    expect(repo.git(repo.qaDir, 'show', 'front-2:app.txt')).toBe('bug front-2');
    expect(repo.git(repo.qaDir, 'show', 'front-2:TICKET.pt.md')).toBe('# front-2 (pt)');
    expect(repo.git(repo.qaDir, 'show', 'front-2:front-1.test.txt')).toBe('regression front-1');
    expect(repo.git(repo.qaDir, 'ls-tree', '--name-only', 'front-2').split('\n')).not.toContain('front-2.test.txt');
  });

  it('fails on a bug.patch that no longer applies, naming the ticket and leaving nothing behind', async () => {
    await writeFile(
      join(repo.qaDir, 'tickets', 'front-2', 'bug.patch'),
      'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-gone\n+bug\n',
    );

    await expect(buildTickets({ qaDir: repo.qaDir, log: () => {} })).rejects.toThrow(/front-2/);

    expect(repo.git(repo.qaDir, 'worktree', 'list').split('\n')).toHaveLength(2);
    expect(repo.git(repo.qaDir, 'branch', '--list', 'build-*')).toBe('');
  });
});
