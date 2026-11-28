/**
 * The services of bd verify on a real Docker: a PostgreSQL and a MySQL that accept connections on
 * the address the variables give, and nothing left behind. Runs only with BD_DOCKER_TESTS=1 (the CI sets it):
 * it pulls the image on the first run.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VERIFY_ROLE_LABEL, startServices, sweepVerifyServices } from '../../src/cli/services.ts';
import { SERVICE_IMAGES } from '../../src/contract/services.ts';
import type { ProjectServices } from '../../src/contract/services.ts';

const services: ProjectServices = {
  db: {
    image: 'postgres:17',
    memory: '256m',
    env: { POSTGRES_PASSWORD: 'cornershop', POSTGRES_DB: 'cornershop' },
    variables: { DATABASE_URL: 'postgres://postgres:cornershop@{{host}}:{{port}}/cornershop' },
  },
};
const REFERENCE = SERVICE_IMAGES['postgres:17']!.reference;

const mysql: ProjectServices = {
  db: {
    image: 'mysql:8.4',
    memory: '512m',
    env: { MYSQL_ROOT_PASSWORD: 'library', MYSQL_DATABASE: 'library' },
    variables: { DATABASE_URL: 'mysql://root:library@{{host}}:{{port}}/library' },
  },
};
const MYSQL_REFERENCE = SERVICE_IMAGES['mysql:8.4']!.reference;

/** The cache of CartWorks: a password and a memory limit, both given as arguments of the server. */
const redis: ProjectServices = {
  cache: {
    image: 'redis:8',
    memory: '128m',
    args: ['--requirepass', 'cartworks', '--maxmemory', '96mb', '--maxmemory-policy', 'allkeys-lru'],
    variables: { REDIS_URL: 'redis://:cartworks@{{host}}:{{port}}' },
  },
};
const REDIS_REFERENCE = SERVICE_IMAGES['redis:8']!.reference;

const docker = (...args: string[]): string => execFileSync('docker', args, { encoding: 'utf8' }).trim();
/** The verify containers of this test process, running or not. */
const mine = (): string[] =>
  docker(
    'ps',
    '--all',
    '--filter',
    `label=${VERIFY_ROLE_LABEL}`,
    '--filter',
    `label=bugdetective.verify-pid=${process.pid}`,
    '--format',
    '{{.Names}}',
  )
    .split('\n')
    .filter(Boolean);

const opens = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

/** Sends each line to a Redis over one connection and gives the server's answer to each. */
const redisSays = (host: string, port: number, lines: string[]): Promise<string[]> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const answers: string[] = [];
    const next = () => {
      const line = lines[answers.length];
      if (line === undefined) {
        socket.destroy();
        resolve(answers);
      } else {
        socket.write(`${line}\r\n`);
      }
    };
    socket.setTimeout(10_000, () => socket.destroy(new Error('the Redis did not answer')));
    socket.once('connect', next);
    socket.on('data', (data) => {
      answers.push(data.toString());
      next();
    });
    socket.once('error', reject);
  });

describe.skipIf(process.env.BD_DOCKER_TESTS !== '1')('project services on a real Docker', () => {
  const had = new Map<string, boolean>();

  beforeAll(() => {
    for (const reference of [REFERENCE, MYSQL_REFERENCE, REDIS_REFERENCE]) {
      had.set(reference, docker('images', '--quiet', reference) !== '');
    }
  });

  afterAll(() => {
    const left = mine();
    if (left.length > 0) {
      docker('rm', '--force', '--volumes', ...left);
    }
    // An image is removed only when this test pulled it.
    for (const [reference, present] of had) {
      if (!present && docker('images', '--quiet', reference) !== '') {
        docker('rmi', reference);
      }
    }
  });

  it('starts a PostgreSQL that answers on the published address, and removes it', async () => {
    const running = await startServices(services, { project: 'docker-test' });
    try {
      const url = new URL(running.env.DATABASE_URL!);
      expect(url.hostname).toBe('127.0.0.1');
      expect(await opens(url.hostname, Number(url.port))).toBe(true);

      const [name] = mine();
      expect(name).toMatch(/^bugdetective-verify-docker-test-db-/);
      expect(docker('exec', name!, 'psql', '-U', 'postgres', '-d', 'cornershop', '-tAc', 'select 1')).toBe('1');
      // Published on the loopback only, never on every interface.
      expect(docker('port', name!, '5432/tcp')).toMatch(/^127\.0\.0\.1:\d+$/);
      // The data lives in memory: no volume, named or anonymous.
      expect(docker('inspect', '--format', '{{range .Mounts}}{{.Type}} {{end}}', name!)).toBe('');
    } finally {
      await running.stop();
    }
    expect(mine()).toEqual([]);
  }, 180_000);

  it('starts a MySQL with 512m, hardened like PostgreSQL, that answers on the published address', async () => {
    const running = await startServices(mysql, { project: 'docker-test' });
    try {
      const url = new URL(running.env.DATABASE_URL!);
      expect(await opens(url.hostname, Number(url.port))).toBe(true);

      const [name] = mine();
      expect(
        docker('exec', name!, 'mysql', '-uroot', '-plibrary', '-h', '127.0.0.1', '-NBe', 'select 1', 'library'),
      ).toBe('1');
      expect(docker('port', name!, '3306/tcp')).toMatch(/^127\.0\.0\.1:\d+$/);
      expect(docker('inspect', '--format', '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}}', name!)).toBe(
        '999:999 true',
      );
    } finally {
      await running.stop();
    }
    expect(mine()).toEqual([]);
  }, 300_000);

  it('starts a Redis with the password and the memory limit its args give', async () => {
    const running = await startServices(redis, { project: 'docker-test' });
    try {
      const url = new URL(running.env.REDIS_URL!);
      expect(url.password).toBe('cartworks');
      const [refused, accepted, limit] = await redisSays(url.hostname, Number(url.port), [
        'PING',
        'AUTH cartworks',
        'CONFIG GET maxmemory',
      ]);
      // Ready although the readiness command knows no password: an answer of NOAUTH is an answer.
      expect(refused).toMatch(/^-NOAUTH/);
      expect(accepted).toBe('+OK\r\n');
      expect(limit).toContain(String(96 * 1024 * 1024));

      const [name] = mine();
      expect(docker('inspect', '--format', '{{json .Config.Cmd}}', name!)).toBe(
        JSON.stringify(['redis-server', ...redis.cache!.args!]),
      );
      expect(docker('inspect', '--format', '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}}', name!)).toBe(
        '999:999 true',
      );
    } finally {
      await running.stop();
    }
    expect(mine()).toEqual([]);
  }, 180_000);

  it('fails at once with the log of a service whose argument the server refuses, and leaves nothing', async () => {
    const mistyped: ProjectServices = { cache: { image: 'redis:8', args: ['--maxmemoryy', '96mb'] } };
    const started = Date.now();
    await expect(startServices(mistyped, { project: 'docker-test' })).rejects.toThrow(/maxmemoryy/);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(mine()).toEqual([]);
  }, 60_000);

  it('fails with the container log when the service cannot start, and leaves nothing', async () => {
    const broken: ProjectServices = { db: { image: 'postgres:17' } };
    await expect(startServices(broken, { project: 'docker-test' })).rejects.toThrow(
      /The service db \(postgres:17\) stopped before it was ready:[\s\S]*superuser password is not specified/,
    );
    expect(mine()).toEqual([]);
  }, 180_000);

  it('bd with-services runs a command that reaches the database, and leaves no container', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bd-with-services-docker-'));
    try {
      const file = join(dir, 'services.json');
      writeFileSync(file, JSON.stringify(services));
      const probe =
        "const u = new URL(process.env.DATABASE_URL); require('node:net').connect({ host: u.hostname, port: Number(u.port) })" +
        ".once('connect', () => process.exit(7)).once('error', () => process.exit(1));";
      const result = spawnSync(
        process.execPath,
        [
          new URL('../../src/cli/main.ts', import.meta.url).pathname,
          'with-services',
          '--file',
          file,
          '--project',
          'docker-test',
          '--',
          process.execPath,
          '-e',
          probe,
        ],
        { encoding: 'utf8' },
      );
      // The command's own exit code comes back.
      expect(result.status, result.stderr).toBe(7);
      expect(docker('ps', '--all', '--filter', `label=${VERIFY_ROLE_LABEL}`, '--format', '{{.Names}}')).not.toMatch(
        /bugdetective-verify-docker-test-/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it('the sweep keeps the containers of a bd verify that is still running', async () => {
    const running = await startServices(services, { project: 'docker-test' });
    try {
      expect(await sweepVerifyServices()).not.toContain(mine()[0]);
      expect(mine()).toHaveLength(1);
    } finally {
      await running.stop();
    }
  }, 180_000);
});
