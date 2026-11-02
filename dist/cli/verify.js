/**
 * bd verify: runs the project's QA tool on every ticket branch, before and after its
 * reference.patch. Expected for every ticket:
 *   buggy: Gate 1 passes, Gate 2 fails   fixed: Gate 1 passes, Gate 2 passes
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIn, resolveBranchRef } from './git.js';
import { run } from './process.js';
import { ticketIdsOf } from './tickets.js';
/** The outcome of each gate: the result names the gate that failed or timed out (2 when passed). */
export function gatesOf(result) {
    if (result.gate === 1) {
        return [result.status === 'timeout' ? 'timeout' : 'fail', 'not-run'];
    }
    return ['pass', result.status === 'passed' ? 'pass' : result.status === 'timeout' ? 'timeout' : 'fail'];
}
/** How to start npm: on Windows it is npm.cmd, a batch file that needs a shell. */
export function npmInvocation(platform) {
    return platform === 'win32' ? { command: 'npm.cmd', shell: true } : { command: 'npm', shell: false };
}
/** The project's QA CLI: `npm run qa` in the qa folder, with a JSON result. */
export const npmQa = async ({ qaDir, id, position, workspace }) => {
    const out = join(await mkdtemp(join(tmpdir(), 'bd-qa-')), 'result.json');
    try {
        const args = [
            'run',
            '--silent',
            'qa',
            '--',
            '--ticket',
            String(position),
            '--package',
            `tickets/${id}`,
            '--workspace',
            workspace,
            '--json',
            out,
        ];
        const npm = npmInvocation(process.platform);
        // Through cmd.exe, each argument is quoted so paths with spaces survive.
        const result = await run(npm.command, npm.shell ? args.map((arg) => `"${arg}"`) : args, {
            cwd: qaDir,
            shell: npm.shell,
        });
        const json = await readFile(out, 'utf8').catch(() => {
            throw new Error(`${id}: the QA tool wrote no result (exit ${result.code}):\n${result.stdout}${result.stderr}`);
        });
        return { ...JSON.parse(json), output: `${result.stdout}${result.stderr}` };
    }
    finally {
        await rm(join(out, '..'), { recursive: true, force: true });
    }
};
export async function verifyTickets({ qaDir, ids, runQa = npmQa, log = () => { }, }) {
    const git = gitIn(qaDir);
    const queue = await ticketIdsOf(git);
    const rows = [];
    const selected = ids ?? queue;
    for (const [index, id] of selected.entries()) {
        const position = queue.indexOf(id) + 1;
        if (position === 0) {
            throw new Error(`Unknown ticket: ${id}`);
        }
        log(`${id}: running QA (${index + 1}/${selected.length})…`);
        const scratch = await mkdtemp(join(tmpdir(), 'bd-verify-'));
        const workspace = join(scratch, id);
        try {
            await git.text('worktree', 'add', '--quiet', '--detach', workspace, await resolveBranchRef(qaDir, id));
            const buggyRun = await runQa({ qaDir, id, position, workspace });
            const buggy = gatesOf(buggyRun);
            const applied = await gitIn(workspace)
                .text('apply', join(qaDir, 'tickets', id, 'reference.patch'))
                .then(() => true, () => false);
            const fixedRun = applied ? await runQa({ qaDir, id, position, workspace }) : undefined;
            const fixed = fixedRun ? gatesOf(fixedRun) : 'patch-failed';
            const ok = buggy.join() === 'pass,fail' && fixed !== 'patch-failed' && fixed.join() === 'pass,pass';
            const logs = [
                `--- buggy run\n${buggyRun.output ?? ''}`,
                `--- fixed run\n${fixedRun?.output ?? 'reference.patch does not apply'}`,
            ].join('\n');
            rows.push({ id, buggy, fixed, ok, ...(!ok && { logs }) });
            const fixedText = fixed === 'patch-failed' ? 'patch-failed' : `(${fixed.join(', ')})`;
            log(`${id}: buggy=(${buggy.join(', ')}) fixed=${fixedText} ${ok ? 'OK' : 'UNEXPECTED'}`);
        }
        finally {
            await git.text('worktree', 'remove', '--force', workspace).catch(() => { });
            await rm(scratch, { recursive: true, force: true });
        }
    }
    return { rows, ok: rows.every((row) => row.ok) };
}
/** The verification matrix as a Markdown table. */
export function formatTable(rows) {
    const lines = [
        '| Ticket | Gate 1 on buggy ticket | Gate 2 on buggy ticket | Gate 1 after reference.patch | Gate 2 after reference.patch | Result |',
        '| --- | --- | --- | --- | --- | --- |',
    ];
    for (const row of rows) {
        const fixed = row.fixed === 'patch-failed' ? ['patch-failed', 'patch-failed'] : row.fixed;
        lines.push(`| ${row.id} | ${row.buggy[0]} | ${row.buggy[1]} | ${fixed[0]} | ${fixed[1]} | ${row.ok ? 'OK' : 'UNEXPECTED'} |`);
    }
    return lines.join('\n');
}
