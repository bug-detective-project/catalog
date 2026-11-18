/**
 * bd with-services: runs a command with a project's services up. The CI of a project's main uses
 * it for npm test: the declaration lives on qa, so main carries a copy of it in a file.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { projectServicesProblems } from '../contract/services.ts';
import type { ProjectServices } from '../contract/services.ts';
import { startServices } from './services.ts';
import type { RunningServices } from './services.ts';

export interface WithServicesOptions {
  /** A JSON file shaped like bugDetective.project.services. */
  file: string;
  /** The command and its arguments. */
  command: readonly string[];
  /** Part of the container names and labels. */
  project: string;
}

export interface WithServicesDeps {
  start?: (services: ProjectServices, options: { project: string }) => Promise<RunningServices>;
  /** Runs the command and resolves with its exit code. */
  run?: (command: readonly string[], env: Record<string, string | undefined>) => Promise<number>;
  env?: Record<string, string | undefined>;
}

const spawnInherit = (command: readonly string[], env: Record<string, string | undefined>): Promise<number> =>
  new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: 'inherit', env, shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

async function readDeclaration(file: string): Promise<ProjectServices> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    throw new Error(`${file}: cannot be read (${(error as Error).message})`);
  }
  let services: unknown;
  try {
    services = JSON.parse(text);
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }
  const problem = projectServicesProblems({ services })[0];
  if (problem) {
    throw new Error(`${file}: ${problem}`);
  }
  return services as ProjectServices;
}

/** Starts the services of the file, runs the command with their variables, and always stops them. */
export async function runWithServices(options: WithServicesOptions, deps: WithServicesDeps = {}): Promise<number> {
  if (options.command.length === 0) {
    throw new Error('bd with-services needs a command after --');
  }
  const services = await readDeclaration(options.file);
  const running = await (deps.start ?? startServices)(services, { project: options.project });
  try {
    return await (deps.run ?? spawnInherit)(options.command, { ...(deps.env ?? process.env), ...running.env });
  } finally {
    await running.stop();
  }
}
