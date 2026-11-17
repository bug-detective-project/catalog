/**
 * Starts and removes the services of a project for bd verify, with the docker CLI of this machine.
 *
 * Every container carries `bugdetective.role=verify-service` and the pid of the bd process that
 * created it, keeps its data in memory (no volume to leave behind) and publishes its port on
 * 127.0.0.1 only, on a free port. Removal never depends on this process's memory surviving: a
 * later run sweeps the containers whose owner is gone.
 */
import { SERVICE_READY_TIMEOUT_MS, serviceImageOf, serviceRunArgs, serviceVariables } from '../contract/services.ts';
import type { ProjectServices } from '../contract/services.ts';
import { run } from './process.ts';

export type Docker = (args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const dockerCli: Docker = async (args) => {
  const result = await run('docker', args);
  return { code: result.code, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
};

/** bd verify cannot run a project with services without Docker; the message says so and why. */
export class DockerUnavailableError extends Error {
  constructor(reason: string) {
    super(`Docker is required to verify a project with services: ${reason}`);
    this.name = 'DockerUnavailableError';
  }
}

export const VERIFY_ROLE_LABEL = 'bugdetective.role=verify-service';
const OWNER_LABEL = 'bugdetective.verify-pid';

export interface RunningServices {
  /** The variables the project's code reads, pointing at 127.0.0.1 and each published port. */
  env: Record<string, string>;
  /** Removes the containers; safe to call more than once. */
  stop(): Promise<void>;
}

export interface StartServicesOptions {
  /** The project id, part of the container names and labels. */
  project: string;
  docker?: Docker;
  readyTimeoutMs?: number;
  pollMs?: number;
}

/** Each start in this process gets its own container names. */
let starts = 0;

const lastLine = (text: string): string => text.trim().split('\n').at(-1)?.trim() ?? '';

async function assertDocker(docker: Docker): Promise<void> {
  let answer: Awaited<ReturnType<Docker>>;
  try {
    answer = await docker(['version', '--format', '{{.Server.Version}}']);
  } catch (error) {
    throw new DockerUnavailableError(
      (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? 'the docker command was not found'
        : (error as Error).message,
    );
  }
  if (answer.code !== 0) {
    throw new DockerUnavailableError(lastLine(answer.stderr) || lastLine(answer.stdout) || 'the daemon did not answer');
  }
}

async function remove(docker: Docker, names: readonly string[]): Promise<void> {
  if (names.length > 0) {
    await docker(['rm', '--force', '--volumes', ...names]);
  }
}

/**
 * Starts every service and waits until each accepts connections. On any failure the containers
 * already created are removed before the error is thrown.
 */
export async function startServices(
  services: ProjectServices,
  options: StartServicesOptions,
): Promise<RunningServices> {
  const docker = options.docker ?? dockerCli;
  const timeout = options.readyTimeoutMs ?? SERVICE_READY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? 200;
  await assertDocker(docker);

  starts += 1;
  const names: string[] = [];
  const ports = new Map<string, number>();
  try {
    for (const [service, declared] of Object.entries(services)) {
      const image = serviceImageOf(declared);
      const label = `The service ${service} (${declared.image})`;
      const name = `bugdetective-verify-${options.project}-${service}-${process.pid}-${starts}`;
      names.push(name);
      const started = await docker([
        'run',
        '--detach',
        ...serviceRunArgs(declared, {
          name,
          labels: {
            'bugdetective.role': 'verify-service',
            'bugdetective.project': options.project,
            [OWNER_LABEL]: String(process.pid),
          },
          data: 'tmpfs',
        }),
        '--publish',
        `127.0.0.1::${image.port}`,
        image.reference,
      ]);
      if (started.code !== 0) {
        throw new Error(`${label} could not be started: ${lastLine(started.stderr) || `exit ${started.code}`}`);
      }
      const published = await docker(['port', name, `${image.port}/tcp`]);
      const port = Number(/:(\d+)\s*$/m.exec(published.stdout.trim().split('\n')[0] ?? '')?.[1]);
      if (published.code !== 0 || !Number.isInteger(port)) {
        throw new Error(`${label} has no published port: ${lastLine(published.stderr) || published.stdout.trim()}`);
      }
      ports.set(service, port);

      const deadline = Date.now() + timeout;
      for (;;) {
        if ((await docker(['exec', name, ...image.ready])).code === 0) {
          break;
        }
        const state = await docker(['inspect', '--format', '{{.State.Running}}', name]);
        const stopped = state.stdout.trim() !== 'true';
        if (stopped || Date.now() >= deadline) {
          const logs = await docker(['logs', '--tail', '20', name]);
          const reason = stopped ? 'stopped before it was ready' : `was not ready after ${timeout / 1000} s`;
          throw new Error(`${label} ${reason}:\n${`${logs.stdout}${logs.stderr}`.trim()}`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    }
  } catch (error) {
    await remove(docker, names).catch(() => {});
    throw error;
  }

  let stopped = false;
  return {
    env: serviceVariables(services, (service) => ({ host: '127.0.0.1', port: ports.get(service) ?? 0 })),
    async stop() {
      if (!stopped) {
        stopped = true;
        await remove(docker, names);
      }
    },
  };
}

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists and belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Removes the verify containers a crashed bd left behind: those whose owner process no longer
 * exists. A bd verify running at the same time keeps its own. Returns the names removed.
 */
export async function sweepVerifyServices(
  options: { docker?: Docker; alive?: (pid: number) => boolean } = {},
): Promise<string[]> {
  const docker = options.docker ?? dockerCli;
  const alive = options.alive ?? processAlive;
  const listed = await docker([
    'ps',
    '--all',
    '--filter',
    `label=${VERIFY_ROLE_LABEL}`,
    '--format',
    `{{.Names}}\t{{.Label "${OWNER_LABEL}"}}`,
  ]);
  const leftovers = listed.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.split('\t'))
    .filter(([, pid]) => !/^\d+$/.test(pid ?? '') || !alive(Number(pid)))
    .map(([name]) => name ?? '');
  await remove(docker, leftovers);
  return leftovers;
}
