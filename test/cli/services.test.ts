import { describe, expect, it } from 'vitest';
import { DockerUnavailableError, startServices, sweepVerifyServices } from '../../src/cli/services.ts';
import type { Docker } from '../../src/cli/services.ts';
import type { ProjectServices } from '../../src/contract/services.ts';

const services: ProjectServices = {
  db: {
    image: 'postgres:17',
    env: { POSTGRES_PASSWORD: 'shop' },
    variables: { DATABASE_URL: 'postgres://postgres:shop@{{host}}:{{port}}/postgres' },
  },
};
const REFERENCE = 'postgres@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac';

type Answer = { code?: number; stdout?: string; stderr?: string };

/** A docker that records every call and answers each subcommand from a script (default: exit 0). */
function fakeDocker(script: Partial<Record<string, (args: readonly string[], nth: number) => Answer>> = {}) {
  const calls: string[][] = [];
  const counts = new Map<string, number>();
  const docker: Docker = async (args) => {
    calls.push([...args]);
    const command = args[0] ?? '';
    const nth = (counts.get(command) ?? 0) + 1;
    counts.set(command, nth);
    const defaults: Answer =
      command === 'port' ? { stdout: '127.0.0.1:49153\n' } : command === 'inspect' ? { stdout: 'true\n' } : {};
    const answer = { ...defaults, ...script[command]?.(args, nth) };
    return { code: answer.code ?? 0, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' };
  };
  const of = (command: string) => calls.filter((call) => call[0] === command);
  return { docker, calls, of };
}

const start = (docker: Docker, extra: Partial<Parameters<typeof startServices>[1]> = {}) =>
  startServices(services, { project: 'shop', docker, pollMs: 1, ...extra });

describe('startServices', () => {
  it('runs each service hardened, with its port published on 127.0.0.1 only, and waits until it is ready', async () => {
    const { docker, of } = fakeDocker({ exec: (_, nth) => ({ code: nth < 3 ? 1 : 0 }) });
    const running = await start(docker);

    const [run] = of('run');
    const name = run![run!.indexOf('--name') + 1]!;
    expect(name).toMatch(new RegExp(`^bugdetective-verify-shop-db-${process.pid}-\\d+$`));
    expect(run).toContain('--detach');
    expect(run!.slice(-3)).toEqual(['--publish', '127.0.0.1::5432', REFERENCE]);
    expect(run!.join(' ')).toContain('--cap-drop ALL');
    expect(run!.join(' ')).toContain('--tmpfs /var/lib/postgresql/data:uid=999,gid=999,mode=0700');
    for (const label of [
      'bugdetective.role=verify-service',
      'bugdetective.project=shop',
      `bugdetective.verify-pid=${process.pid}`,
    ]) {
      expect(run![run!.indexOf(label) - 1]).toBe('--label');
    }
    expect(of('port')).toEqual([['port', name, '5432/tcp']]);
    expect(of('exec')).toHaveLength(3);
    expect(of('exec')[0]).toEqual(['exec', name, 'pg_isready', '-q', '-h', '127.0.0.1']);
    expect(running.env).toEqual({ DATABASE_URL: 'postgres://postgres:shop@127.0.0.1:49153/postgres' });
  });

  it('runs the server program and the args after the image', async () => {
    const cache: ProjectServices = {
      cache: {
        image: 'redis:8',
        args: ['--requirepass', 'cartworks', '--maxmemory', '96mb'],
        variables: { REDIS_URL: 'redis://:cartworks@{{host}}:{{port}}' },
      },
    };
    const { docker, of } = fakeDocker();
    const running = await startServices(cache, { project: 'shop', docker, pollMs: 1 });

    const [run] = of('run');
    expect(run!.slice(-8)).toEqual([
      '--publish',
      '127.0.0.1::6379',
      'redis@sha256:91cc9227bca4d2f717b1ad33d2ebba8127c16b0c2ca731dd9e6010d7629227a5',
      'redis-server',
      '--requirepass',
      'cartworks',
      '--maxmemory',
      '96mb',
    ]);
    expect(of('exec')[0]!.slice(2)).toEqual(['redis-cli', '-h', '127.0.0.1', 'ping']);
    expect(running.env).toEqual({ REDIS_URL: 'redis://:cartworks@127.0.0.1:49153' });
  });

  it('runs nothing after the image without args', async () => {
    const { docker, of } = fakeDocker();
    await start(docker);
    expect(of('run')[0]!.at(-1)).toBe(REFERENCE);
  });

  it('gives every run its own container names', async () => {
    const { docker, of } = fakeDocker();
    await start(docker);
    await start(docker);
    const names = of('run').map((run) => run[run.indexOf('--name') + 1]);
    expect(new Set(names).size).toBe(2);
  });

  it('stop removes the containers, and may be called twice', async () => {
    const { docker, of } = fakeDocker();
    const running = await start(docker);
    const name = of('run')[0]![of('run')[0]!.indexOf('--name') + 1];
    await running.stop();
    await running.stop();
    expect(of('rm')).toEqual([['rm', '--force', '--volumes', name]]);
  });

  it('says Docker is required when the daemon does not answer, and starts nothing', async () => {
    const { docker, of } = fakeDocker({ version: () => ({ code: 1, stderr: 'Cannot connect to the Docker daemon' }) });
    const failure = await start(docker).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DockerUnavailableError);
    expect((failure as Error).message).toBe(
      'Docker is required to verify a project with services: Cannot connect to the Docker daemon',
    );
    expect(of('run')).toHaveLength(0);
  });

  it('says Docker is required when the docker command is missing', async () => {
    const docker: Docker = async () => {
      throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
    };
    await expect(start(docker)).rejects.toBeInstanceOf(DockerUnavailableError);
  });

  it('fails with the container log when a service exits, and removes it', async () => {
    const { docker, of } = fakeDocker({
      exec: () => ({ code: 1 }),
      inspect: () => ({ stdout: 'false\n' }),
      logs: () => ({ stderr: 'Error: Database is uninitialized and superuser password is not specified.\n' }),
    });
    await expect(start(docker)).rejects.toThrow(
      /The service db \(postgres:17\) stopped before it was ready:\nError: Database is uninitialized/,
    );
    expect(of('logs')[0]!.slice(0, 3)).toEqual(['logs', '--tail', '20']);
    expect(of('rm')).toHaveLength(1);
  });

  it('fails with the container log when a service exits before its port can be read', async () => {
    const { docker, of } = fakeDocker({
      port: () => ({ code: 1, stdout: '', stderr: 'no public port' }),
      inspect: () => ({ stdout: 'false\n' }),
      logs: () => ({ stderr: 'Error: superuser password is not specified.\n' }),
    });
    await expect(start(docker)).rejects.toThrow(
      /The service db \(postgres:17\) stopped before it was ready:\nError: superuser password/,
    );
    expect(of('exec')).toHaveLength(0);
    expect(of('rm')).toHaveLength(1);
  });

  it('fails when a service is not ready in time, and removes it', async () => {
    const { docker, of } = fakeDocker({ exec: () => ({ code: 1 }), inspect: () => ({ stdout: 'true\n' }) });
    await expect(start(docker, { readyTimeoutMs: 20 })).rejects.toThrow(
      /The service db \(postgres:17\) was not ready after 0\.02 s/,
    );
    expect(of('rm')).toHaveLength(1);
  });

  it('removes the services already started when a later one cannot run', async () => {
    const two: ProjectServices = { db: services.db!, audit: { image: 'postgres:17' } };
    const { docker, of } = fakeDocker({ run: (_, nth) => (nth === 2 ? { code: 125, stderr: 'no such image' } : {}) });
    await expect(startServices(two, { project: 'shop', docker, pollMs: 1 })).rejects.toThrow(
      /The service audit \(postgres:17\) could not be started: no such image/,
    );
    const removed = of('rm').flatMap((call) => call.slice(3));
    expect(removed).toHaveLength(2);
    expect(removed.some((name) => name.includes('-db-'))).toBe(true);
  });
});

describe('sweepVerifyServices', () => {
  it('removes only the containers whose bd verify process is gone', async () => {
    const { docker, of } = fakeDocker({
      ps: () => ({ stdout: 'bugdetective-verify-shop-db-111-1\t111\nbugdetective-verify-shop-db-222-1\t222\nodd\t\n' }),
    });
    const removed = await sweepVerifyServices({ docker, alive: (pid) => pid === 222 });
    expect(of('ps')[0]).toEqual([
      'ps',
      '--all',
      '--filter',
      'label=bugdetective.role=verify-service',
      '--format',
      '{{.Names}}\t{{.Label "bugdetective.verify-pid"}}',
    ]);
    expect(removed).toEqual(['bugdetective-verify-shop-db-111-1', 'odd']);
    expect(of('rm')).toEqual([['rm', '--force', '--volumes', 'bugdetective-verify-shop-db-111-1', 'odd']]);
  });

  it('does nothing when there is nothing left over', async () => {
    const { docker, of } = fakeDocker();
    expect(await sweepVerifyServices({ docker })).toEqual([]);
    expect(of('rm')).toHaveLength(0);
  });
});
