import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatTable, gatesOf, verifyTickets } from '../../src/cli/verify.ts';
import type { RunQa } from '../../src/cli/verify.ts';
import { useRealPatches } from '../helpers/patches.ts';
import { createProjectRepo } from '../helpers/project-repo.ts';
import type { ProjectRepo } from '../helpers/project-repo.ts';

describe('gatesOf', () => {
  it.each([
    [{ gate: 1, status: 'failed' }, ['fail', 'not-run']],
    [{ gate: 1, status: 'timeout' }, ['timeout', 'not-run']],
    [{ gate: 2, status: 'failed' }, ['pass', 'fail']],
    [{ gate: 2, status: 'timeout' }, ['pass', 'timeout']],
    [{ gate: 2, status: 'passed' }, ['pass', 'pass']],
  ] as const)('%j → %j', (result, gates) => {
    expect(gatesOf(result)).toEqual(gates);
  });
});

describe('bd verify', () => {
  let dir: string;
  let repo: ProjectRepo;
  const ids = ['front-1', 'front-2', 'back-1'];
  // A QA tool that passes Gate 2 only when app.txt is fixed, and records the positions it was given.
  const positions: Record<string, number> = {};
  const runQa: RunQa = async ({ id, position, workspace }) => {
    positions[id] = position;
    const fixed = (await readFile(join(workspace, 'app.txt'), 'utf8')) === 'fixed\n';
    return { gate: 2, status: fixed ? 'passed' : 'failed' };
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bd-verify-'));
    repo = await createProjectRepo(dir, { front: 2, back: 1 });
    await useRealPatches(repo, ids);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('expects Gate 2 to fail with the bug and both gates to pass after reference.patch', async () => {
    const { rows, ok } = await verifyTickets({ qaDir: repo.qaDir, runQa });

    expect(ok).toBe(true);
    expect(rows.map((row) => [row.id, row.buggy, row.fixed, row.ok])).toEqual([
      ['front-1', ['pass', 'fail'], ['pass', 'pass'], true],
      ['front-2', ['pass', 'fail'], ['pass', 'pass'], true],
      ['back-1', ['pass', 'fail'], ['pass', 'pass'], true],
    ]);
    expect(positions).toEqual({ 'front-1': 1, 'front-2': 2, 'back-1': 3 });
    expect(repo.git(repo.qaDir, 'worktree', 'list').split('\n')).toHaveLength(2);
  });

  it('verifies only the tickets asked for', async () => {
    const { rows } = await verifyTickets({ qaDir: repo.qaDir, ids: ['back-1'], runQa });
    expect(rows.map((row) => row.id)).toEqual(['back-1']);
  });

  it('marks a reference.patch that does not apply as patch-failed', async () => {
    await writeFile(
      join(repo.qaDir, 'tickets', 'front-2', 'reference.patch'),
      'diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-gone\n+fixed\n',
    );

    const { rows, ok } = await verifyTickets({ qaDir: repo.qaDir, runQa });

    expect(ok).toBe(false);
    expect(rows[1]).toMatchObject({ id: 'front-2', fixed: 'patch-failed', ok: false });
    expect(formatTable(rows)).toContain('| front-2 | pass | fail | patch-failed | patch-failed | UNEXPECTED |');
  });

  it('keeps the QA output of an unexpected row, to show where it failed', async () => {
    const noisy: RunQa = async (args) => ({
      ...(await runQa(args)),
      gate: 1,
      status: 'failed',
      output: `gate 1 log of ${args.id}`,
    });
    const { rows } = await verifyTickets({ qaDir: repo.qaDir, ids: ['front-1'], runQa: noisy });
    expect(rows[0].ok).toBe(false);
    expect(rows[0].logs).toContain('gate 1 log of front-1');
  });
});
