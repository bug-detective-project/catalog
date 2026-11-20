import { describe, expect, it } from 'vitest';
import {
  SERVICE_IMAGES,
  memoryBytes,
  peakMemory,
  projectServicesProblems,
  serviceRunArgs,
  serviceVariables,
} from '../../src/contract/services.ts';
import type { ProjectServices } from '../../src/contract/services.ts';

const GB = 1024 ** 3;

const db = {
  image: 'postgres:17',
  memory: '256m',
  env: { POSTGRES_PASSWORD: 'cornershop', POSTGRES_DB: 'cornershop' },
  variables: { DATABASE_URL: 'postgres://postgres:cornershop@{{host}}:{{port}}/cornershop' },
};
const services: ProjectServices = { db };

/** A service that differs from the example in one field. */
const withDb = (change: Record<string, unknown>) => ({ services: { db: { ...db, ...change } } });

describe('the image list', () => {
  it('pins postgres:17 by digest, with what the app needs to run it', () => {
    expect(SERVICE_IMAGES['postgres:17']).toEqual({
      reference: 'postgres@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac',
      port: 5432,
      user: '999:999',
      dataPaths: ['/var/lib/postgresql/data'],
      tmpfsPaths: ['/var/run/postgresql', '/tmp'],
      ready: ['pg_isready', '-q', '-h', '127.0.0.1'],
    });
  });

  it('pins mysql:8.4 by digest, with what the app needs to run it', () => {
    expect(SERVICE_IMAGES['mysql:8.4']).toEqual({
      reference: 'mysql@sha256:a81d043930e51745522bd5c430961cf8286f0a23f0a9a2a6e0108f7ea71b0902',
      port: 3306,
      user: '999:999',
      dataPaths: ['/var/lib/mysql'],
      tmpfsPaths: ['/var/run/mysqld', '/var/lib/mysql-files', '/tmp'],
      ready: ['mysqladmin', 'ping', '--silent', '-h', '127.0.0.1'],
    });
  });

  it('accepts a MySQL service', () => {
    const mysql = {
      image: 'mysql:8.4',
      memory: '512m',
      env: { MYSQL_ROOT_PASSWORD: 'library', MYSQL_DATABASE: 'library' },
      variables: { DATABASE_URL: 'mysql://root:library@{{host}}:{{port}}/library' },
    };
    expect(projectServicesProblems({ services: { db: mysql } })).toEqual([]);
  });
});

describe('a project services declaration', () => {
  it('accepts the example of the design', () => {
    expect(projectServicesProblems({ services })).toEqual([]);
  });

  it('accepts a service that asks for its port to be published on the computer', () => {
    expect(projectServicesProblems({ services: { db: { ...db, publish: true } } })).toEqual([]);
    expect(projectServicesProblems({ services: { db: { ...db, publish: false } } })).toEqual([]);
  });

  it('refuses a publish that is not true or false, naming the field', () => {
    const problems = projectServicesProblems({ services: { db: { ...db, publish: '5432:5432' } } });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^services\.db\.publish: /);
  });

  it('accepts a project without services or memory', () => {
    expect(projectServicesProblems({})).toEqual([]);
  });

  it('accepts a service with only its image, and a larger workspace', () => {
    expect(
      projectServicesProblems({ services: { db: { image: 'postgres:17' } }, memory: { workspace: '4g' } }),
    ).toEqual([]);
  });

  it.each([
    ['an image off the list', withDb({ image: 'mysql:8' }), 'services.db.image'],
    ['an upper-case name', { services: { DB: db } }, 'services.DB'],
    ['a name of 21 characters', { services: { ['a'.repeat(21)]: db } }, `services.${'a'.repeat(21)}`],
    ['a fractional memory', withDb({ memory: '0.5g' }), 'services.db.memory'],
    ['an upper-case memory unit', withDb({ memory: '256M' }), 'services.db.memory'],
    ['a memory without a unit', withDb({ memory: '256' }), 'services.db.memory'],
    ['a memory below 64 MB', withDb({ memory: '32m' }), 'services.db.memory'],
    ['a memory above 1 GB', withDb({ memory: '2g' }), 'services.db.memory'],
    ['a lower-case variable', withDb({ variables: { database_url: 'x' } }), 'services.db.variables.database_url'],
    ['an app variable', withDb({ variables: { BUGDETECTIVE_X: 'x' } }), 'services.db.variables.BUGDETECTIVE_X'],
    ['a reserved variable', withDb({ variables: { PATH: 'x' } }), 'services.db.variables.PATH'],
    [
      'an unknown marker',
      withDb({ variables: { DATABASE_URL: 'pg://{{user}}@{{host}}' } }),
      'services.db.variables.DATABASE_URL',
    ],
    ['an unknown field', withDb({ ports: ['5432:5432'] }), 'services.db'],
    ['a workspace above 4 GB', { memory: { workspace: '5g' } }, 'memory.workspace'],
  ])('refuses %s, naming the field', (_, project, field) => {
    const problems = projectServicesProblems(project);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^${field}: .+`));
  });

  it('refuses five services', () => {
    const five = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((name) => [name, { image: 'postgres:17' }]));
    expect(projectServicesProblems({ services: five })).toEqual(['services: at most 4 services']);
  });

  it('refuses the same variable in two services', () => {
    const problems = projectServicesProblems({ services: { db, other: db } });
    expect(problems).toEqual(['services.other.variables.DATABASE_URL: already defined by the service db']);
  });

  it('refuses a memory peak above 8 GB', () => {
    const four = Object.fromEntries(['a', 'b', 'c', 'd'].map((name) => [name, { image: 'postgres:17', memory: '1g' }]));
    expect(projectServicesProblems({ services: four, memory: { workspace: '4g' } })).toEqual([
      'memory: the peak is 14 GB (workspace, services, QA and its services at the same time) and the limit is 8 GB',
    ]);
  });
});

describe('memory', () => {
  it('reads k, m and g sizes', () => {
    expect(memoryBytes('65536k')).toBe(64 * 1024 ** 2);
    expect(memoryBytes('256m')).toBe(256 * 1024 ** 2);
    expect(memoryBytes('1g')).toBe(GB);
  });

  it.each(['0.5g', '256M', '256', '', '1gb', '-1g'])('refuses %j', (value) => {
    expect(() => memoryBytes(value)).toThrow(/memory size/);
  });

  it('adds the workspace, the services, QA and the services of QA', () => {
    expect(peakMemory({ services })).toBe((3 + 0.25 + 2 + 0.25) * GB);
    expect(peakMemory({})).toBe(5 * GB);
    expect(peakMemory({ services: { db: { image: 'postgres:17' } }, memory: { workspace: '4g' } })).toBe(6.5 * GB);
  });
});

describe('the variables of the code', () => {
  it('fills the host and the port of each service', () => {
    expect(serviceVariables(services, () => ({ host: '127.0.0.1', port: 49153 }))).toEqual({
      DATABASE_URL: 'postgres://postgres:cornershop@127.0.0.1:49153/cornershop',
    });
  });

  it('asks the address by service name', () => {
    const two: ProjectServices = {
      db: { image: 'postgres:17', variables: { DB_HOST: '{{host}}', DB_PORT: '{{port}}' } },
      audit: { image: 'postgres:17', variables: { AUDIT_URL: 'pg://{{host}}:{{port}}' } },
    };
    expect(serviceVariables(two, (name) => ({ host: name, port: 5432 }))).toEqual({
      DB_HOST: 'db',
      DB_PORT: '5432',
      AUDIT_URL: 'pg://audit:5432',
    });
  });
});

describe('the docker run arguments of a service', () => {
  const labels = { 'bugdetective.role': 'verify-service', 'bugdetective.project': 'shop' };

  /** True when `flag value` appears as two consecutive arguments. */
  const has = (args: string[], flag: string, value: string) =>
    args.some((arg, index) => arg === flag && args[index + 1] === value);

  it('limits, hardens and labels the container, with its data in memory', () => {
    const args = serviceRunArgs(db, { name: 'svc', labels, data: 'tmpfs' });
    expect(has(args, '--name', 'svc')).toBe(true);
    expect(has(args, '--memory', '256m')).toBe(true);
    expect(has(args, '--pids-limit', '256')).toBe(true);
    expect(has(args, '--cap-drop', 'ALL')).toBe(true);
    expect(has(args, '--security-opt', 'no-new-privileges')).toBe(true);
    expect(has(args, '--user', '999:999')).toBe(true);
    expect(has(args, '--restart', 'no')).toBe(true);
    expect(args).toContain('--read-only');
    expect(has(args, '--tmpfs', '/var/run/postgresql')).toBe(true);
    expect(has(args, '--tmpfs', '/tmp')).toBe(true);
    expect(has(args, '--tmpfs', '/var/lib/postgresql/data:uid=999,gid=999,mode=0700')).toBe(true);
    expect(has(args, '--env', 'POSTGRES_PASSWORD=cornershop')).toBe(true);
    expect(has(args, '--env', 'POSTGRES_DB=cornershop')).toBe(true);
    expect(has(args, '--label', 'bugdetective.role=verify-service')).toBe(true);
    expect(has(args, '--label', 'bugdetective.project=shop')).toBe(true);
    expect(args.join(' ')).not.toMatch(/--publish|--network|--privileged|--mount/);
  });

  it('mounts a named volume on each data path instead', () => {
    const args = serviceRunArgs(db, { name: 'svc', labels, data: { '/var/lib/postgresql/data': 'svc-data' } });
    expect(has(args, '--mount', 'type=volume,src=svc-data,dst=/var/lib/postgresql/data')).toBe(true);
    expect(args.join(' ')).not.toContain('--tmpfs /var/lib/postgresql/data');
  });

  it('uses the default memory when the service declares none', () => {
    const args = serviceRunArgs({ image: 'postgres:17' }, { name: 'svc', labels: {}, data: 'tmpfs' });
    expect(has(args, '--memory', '256m')).toBe(true);
  });

  it('refuses a data path without a volume', () => {
    expect(() => serviceRunArgs(db, { name: 'svc', labels: {}, data: {} })).toThrow(/\/var\/lib\/postgresql\/data/);
  });
});
