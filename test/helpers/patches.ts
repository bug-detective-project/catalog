/**
 * Real patches for the test project of project-repo.ts: main has app.txt ("fixed") and
 * app.test.txt; each ticket's bug.patch breaks app.txt, and its reference.patch fixes it and adds
 * the ticket's regression test, <id>.test.txt.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectRepo } from './project-repo.ts';

export function bugPatch(id: string): string {
  return `diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-fixed\n+bug ${id}\n`;
}

export function referencePatch(id: string): string {
  return (
    `diff --git a/app.txt b/app.txt\n--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-bug ${id}\n+fixed\n` +
    `diff --git a/${id}.test.txt b/${id}.test.txt\nnew file mode 100644\n--- /dev/null\n+++ b/${id}.test.txt\n@@ -0,0 +1 @@\n+regression ${id}\n`
  );
}

/** Adds app.test.txt to main and real patches to every ticket, committed on both branches. */
export async function useRealPatches(repo: ProjectRepo, ids: string[]): Promise<void> {
  await writeFile(join(repo.projectDir, 'app.test.txt'), 'main test\n');
  repo.git(repo.projectDir, 'add', 'app.test.txt');
  repo.git(repo.projectDir, 'commit', '-q', '-m', 'Add the app test');
  for (const id of ids) {
    await writeFile(join(repo.qaDir, 'tickets', id, 'bug.patch'), bugPatch(id));
    await writeFile(join(repo.qaDir, 'tickets', id, 'reference.patch'), referencePatch(id));
  }
  repo.git(repo.qaDir, 'add', '-A');
  repo.git(repo.qaDir, 'commit', '-q', '-m', 'Real patches');
}
