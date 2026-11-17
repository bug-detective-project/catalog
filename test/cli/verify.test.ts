import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatTable, gatesOf, npmInvocation, verifyTickets } from '../../src/cli/verify.ts';
import { DockerUnavailableError } from '../../src/cli/services.ts';
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

  it('reports each ticket as it starts and as it finishes, before the whole run ends', async () => {
    const lines: string[] = [];
    await verifyTickets({ qaDir: repo.qaDir, ids: ['front-1', 'back-1'], runQa, log: (line) => lines.push(line) });
    expect(lines).toEqual([
      'front-1: running QA (1/2)…',
      'front-1: buggy=(pass, fail) fixed=(pass, pass) OK',
      'back-1: running QA (2/2)…',
      'back-1: buggy=(pass, fail) fixed=(pass, pass) OK',
    ]);
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

describe('bd verify of a project with services', () => {
  let dir: string;
  let repo: ProjectRepo;
  const ids = ['front-1', 'back-1'];
  const declared = { db: { image: 'postgres:17', variables: { DATABASE_URL: 'pg://{{host}}:{{port}}' } } };

  /** Records, in order, every sweep, start, QA run and stop. */
  function recorder() {
    const events: string[] = [];
    let starts = 0;
    const services = {
      sweep: async () => {
        events.push('sweep');
        return [];
      },
      start: async (given: unknown, options: { project: string }) => {
        starts += 1;
        const n = starts;
        events.push(`start ${n} ${options.project} ${Object.keys(given as object).join(',')}`);
        return { env: { DATABASE_URL: `pg://127.0.0.1:${5000 + n}` }, stop: async () => void events.push(`stop ${n}`) };
      },
    };
    const runQa: RunQa = async ({ id, workspace, env }) => {
      events.push(`qa ${id} ${env?.DATABASE_URL ?? 'no env'}`);
      const fixed = (await readFile(join(workspace, 'app.txt'), 'utf8')) === 'fixed\n';
      return { gate: 2, status: fixed ? 'passed' : 'failed' };
    };
    return { events, services, runQa };
  }

  async function declare(project: Record<string, unknown>) {
    const file = join(repo.qaDir, 'package.json');
    const pkg = JSON.parse(await readFile(file, 'utf8'));
    Object.assign(pkg.bugDetective.project, project);
    await writeFile(file, JSON.stringify(pkg));
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bd-verify-services-'));
    repo = await createProjectRepo(dir, { front: 1, back: 1 });
    await useRealPatches(repo, ids);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('starts nothing for a project without services', async () => {
    const { events, services, runQa } = recorder();
    const { ok } = await verifyTickets({ qaDir: repo.qaDir, ids: ['front-1'], runQa, services });
    expect(ok).toBe(true);
    expect(events).toEqual(['qa front-1 no env', 'qa front-1 no env']);
  });

  it('sweeps once, then gives every QA run fresh services and removes them after it', async () => {
    await declare({ services: declared });
    const { events, services, runQa } = recorder();
    const { ok } = await verifyTickets({ qaDir: repo.qaDir, runQa, services });
    expect(ok).toBe(true);
    expect(events).toEqual([
      'sweep',
      'start 1 demo db',
      'qa front-1 pg://127.0.0.1:5001',
      'stop 1',
      'start 2 demo db',
      'qa front-1 pg://127.0.0.1:5002',
      'stop 2',
      'start 3 demo db',
      'qa back-1 pg://127.0.0.1:5003',
      'stop 3',
      'start 4 demo db',
      'qa back-1 pg://127.0.0.1:5004',
      'stop 4',
    ]);
  });

  it('removes the services when the QA tool throws', async () => {
    await declare({ services: declared });
    const { events, services } = recorder();
    const runQa: RunQa = async () => {
      throw new Error('the QA tool wrote no result');
    };
    await expect(verifyTickets({ qaDir: repo.qaDir, ids: ['front-1'], runQa, services })).rejects.toThrow(/no result/);
    expect(events).toEqual(['sweep', 'start 1 demo db', 'stop 1']);
    expect(repo.git(repo.qaDir, 'worktree', 'list').split('\n')).toHaveLength(2);
  });

  it('removes the running services when the run is interrupted', async () => {
    await declare({ services: declared });
    const { events, services } = recorder();
    let interrupt: (() => Promise<void>) | undefined;
    let unregistered = false;
    const onInterrupt = (handler: () => Promise<void>) => {
      interrupt = handler;
      return () => {
        unregistered = true;
      };
    };
    const runQa: RunQa = async () => {
      await interrupt!();
      events.push('interrupted');
      return { gate: 2, status: 'failed' };
    };
    await verifyTickets({ qaDir: repo.qaDir, ids: ['front-1'], runQa, services, onInterrupt });
    expect(events.slice(0, 4)).toEqual(['sweep', 'start 1 demo db', 'stop 1', 'interrupted']);
    expect(unregistered).toBe(true);
  });

  it('lets the missing Docker error through, with its own message', async () => {
    await declare({ services: declared });
    const { services, runQa } = recorder();
    const start = async () => {
      throw new DockerUnavailableError('the docker command was not found');
    };
    await expect(
      verifyTickets({ qaDir: repo.qaDir, ids: ['front-1'], runQa, services: { ...services, start } }),
    ).rejects.toThrow('Docker is required to verify a project with services: the docker command was not found');
  });
});

describe('npmInvocation', () => {
  it('runs npm directly on Linux and macOS', () => {
    expect(npmInvocation('linux')).toEqual({ command: 'npm', shell: false });
    expect(npmInvocation('darwin')).toEqual({ command: 'npm', shell: false });
  });

  it('runs npm.cmd through the shell on Windows, where npm is a batch file', () => {
    expect(npmInvocation('win32')).toEqual({ command: 'npm.cmd', shell: true });
  });
});
