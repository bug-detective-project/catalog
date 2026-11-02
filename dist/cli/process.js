/** Runs external commands (git, npm) with argument arrays, never through a shell. */
import { spawn } from 'node:child_process';
export function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env ?? process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(chunk));
        child.stderr.on('data', (chunk) => stderr.push(chunk));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
    });
}
/** Like run, but a non-zero exit is an error that carries the command's stderr. */
export async function runChecked(command, args, options = {}) {
    const result = await run(command, args, options);
    if (result.code !== 0) {
        const detail = result.stderr.toString('utf8').trim() || result.stdout.toString('utf8').trim();
        throw new Error(`${command} ${args.join(' ')} failed (exit ${result.code})${detail ? `:\n${detail}` : ''}`);
    }
    return result;
}
