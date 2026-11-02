/**
 * bd build: regenerates every tickets/<id>/gate1/ and rebuilds one branch per ticket from main.
 *
 * gate1/ (commit the result) holds the test files of main (any *.test.* / *.spec.* file and
 * everything under a test/ folder) plus the regression test of every OTHER ticket: the new test
 * files its reference.patch adds. The player takes tickets in any order, so Gate 1 always covers
 * every other ticket.
 *
 * Each ticket branch is a single orphan commit ("<Project> release <id>") with the app from main,
 * the ticket's bug.patch, its gate1/ in place of main's tests, and its Jira card at the root as
 * TICKET.en.md and TICKET.pt.md.
 */
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readProject } from './manifest.ts';
import { gitIn } from './git.ts';
import { runChecked } from './process.ts';
import { ticketIdsOf } from './tickets.ts';

const MAIN_TEST = /(\.test\.|\.spec\.)|(^|\/)test\//;
const TEST_NAME = /\.(test|spec)\./;

export interface BuildOptions {
  qaDir: string;
  /** The ref the ticket branches are built from. */
  base?: string;
  log: (line: string) => void;
}

/** Writes the new test files of a reference.patch (its regression test) under a folder. */
async function writeRegressionTests(patch: string, into: string): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'bd-regression-'));
  try {
    // Outside any repository, git apply works on plain files: only the new test files are written.
    await runChecked('git', ['apply', '--include=*.test.*', '--include=*.spec.*', patch], { cwd: scratch });
    await cp(scratch, into, { recursive: true });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function writeGate1(qaDir: string, base: string, id: string, ids: string[]): Promise<void> {
  const git = gitIn(qaDir);
  const gate1 = join(qaDir, 'tickets', id, 'gate1');
  await rm(gate1, { recursive: true, force: true });
  await mkdir(gate1, { recursive: true });
  const files = (await git.text('ls-tree', '-r', '--name-only', base))
    .split('\n')
    .filter((file) => MAIN_TEST.test(file));
  for (const file of files) {
    const { stdout } = await runChecked('git', ['-c', 'safe.directory=*', '-C', qaDir, 'show', `${base}:${file}`]);
    await mkdir(dirname(join(gate1, file)), { recursive: true });
    await writeFile(join(gate1, file), stdout);
  }
  for (const other of ids.filter((item) => item !== id)) {
    await writeRegressionTests(join(qaDir, 'tickets', other, 'reference.patch'), gate1);
  }
}

/** Every test file of the worktree by name (*.test.* / *.spec.*), outside .git. */
async function testFilesOf(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && TEST_NAME.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.slice(dir.length).split('/').includes('.git'));
}

async function buildBranch(qaDir: string, base: string, id: string, project: string): Promise<string> {
  const git = gitIn(qaDir);
  const scratch = await mkdtemp(join(tmpdir(), 'bd-build-'));
  const worktree = join(scratch, 'ticket');
  const ticket = join(qaDir, 'tickets', id);
  try {
    await git.text('worktree', 'add', '--quiet', '--detach', worktree, base);
    const wt = gitIn(worktree);
    await wt.text('checkout', '--quiet', '--orphan', `build-${id}`);
    try {
      await wt.text('apply', join(ticket, 'bug.patch'));
    } catch (error) {
      throw new Error(`${id}: bug.patch does not apply on ${base}: ${(error as Error).message}`, { cause: error });
    }
    for (const file of await testFilesOf(worktree)) {
      await rm(file);
    }
    await cp(join(ticket, 'gate1'), worktree, { recursive: true });
    await cp(join(ticket, 'ticket.en.md'), join(worktree, 'TICKET.en.md'));
    await cp(join(ticket, 'ticket.pt.md'), join(worktree, 'TICKET.pt.md'));
    await wt.text('add', '-A');
    await wt.text('commit', '--quiet', '-m', `${project} release ${id}`);
    const commit = await wt.text('rev-parse', 'HEAD');
    await git.text('branch', '--force', id, commit);
    return commit;
  } finally {
    await git.text('worktree', 'remove', '--force', worktree).catch(() => {});
    await git.text('branch', '--quiet', '-D', `build-${id}`).catch(() => {});
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function buildTickets({ qaDir, base = 'main', log }: BuildOptions): Promise<void> {
  const ids = await ticketIdsOf(gitIn(qaDir));
  const { name } = await readProject(qaDir);
  for (const id of ids) {
    await writeGate1(qaDir, base, id, ids);
    log(`${id}: gate1 = tests of ${base} + the regression tests of the other tickets`);
  }
  for (const id of ids) {
    const commit = await buildBranch(qaDir, base, id, name);
    log(`${id}: ${commit.slice(0, 7)} ${name} release ${id}`);
  }
}
