/**
 * The services of bd verify on a real Docker: a PostgreSQL that accepts connections on the address
 * the variables give, and nothing left behind. Runs only with BD_DOCKER_TESTS=1 (the CI sets it):
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

describe.skipIf(process.env.BD_DOCKER_TESTS !== '1')('project services on a real Docker', () => {
  let hadImage = false;

  beforeAll(() => {
    hadImage = docker('images', '--quiet', REFERENCE) !== '';
  });

  afterAll(() => {
    const left = mine();
    if (left.length > 0) {
      docker('rm', '--force', '--volumes', ...left);
    }
    // The image is removed only when this test pulled it.
    if (!hadImage && docker('images', '--quiet', REFERENCE) !== '') {
      docker('rmi', REFERENCE);
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
