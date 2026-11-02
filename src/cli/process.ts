/** Runs external commands (git, npm) with argument arrays; only npm.cmd on Windows goes through a shell. */
import { spawn } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Only for Windows batch files (npm.cmd), which Node cannot start without a shell. */
  shell?: boolean;
}

export function run(command: string, args: readonly string[], options: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }),
    );
  });
}

/** Like run, but a non-zero exit is an error that carries the command's stderr. */
export async function runChecked(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const detail = result.stderr.toString('utf8').trim() || result.stdout.toString('utf8').trim();
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.code})${detail ? `:\n${detail}` : ''}`);
  }
  return result;
}
