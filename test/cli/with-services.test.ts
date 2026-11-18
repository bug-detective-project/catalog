import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runWithServices } from '../../src/cli/with-services.ts';
import type { ProjectServices } from '../../src/contract/services.ts';

const dir = mkdtempSync(join(tmpdir(), 'bd-with-services-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const declared: ProjectServices = {
  db: {
    image: 'postgres:17',
    env: { POSTGRES_PASSWORD: 'shop' },
    variables: { DATABASE_URL: 'postgres://postgres:shop@{{host}}:{{port}}/postgres' },
  },
};
const file = (name: string, content: string): string => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};
const good = file('services.json', JSON.stringify(declared));

/** Fake services that record what happened, and a fake command runner. */
function world(exitCode = 0, fails?: Error) {
  const events: string[] = [];
  let seen: { command: readonly string[]; env: Record<string, string | undefined> } | undefined;
  return {
    events,
    seen: () => seen,
    deps: {
      start: async (services: ProjectServices, options: { project: string }) => {
        events.push(`start ${Object.keys(services).join(',')} ${options.project}`);
        return {
          env: { DATABASE_URL: 'postgres://postgres:shop@127.0.0.1:49153/postgres' },
          stop: async () => {
            events.push('stop');
          },
        };
      },
      run: async (command: readonly string[], env: Record<string, string | undefined>) => {
        events.push('run');
        seen = { command, env };
        if (fails) throw fails;
        return exitCode;
      },
      env: { PATH: '/bin', DATABASE_URL: 'stale' },
    },
  };
}

describe('runWithServices', () => {
  it('starts the services, runs the command with their variables and stops them', async () => {
    const { deps, events, seen } = world();
    expect(await runWithServices({ file: good, command: ['npm', 'test'], project: 'shop' }, deps)).toBe(0);
    expect(events).toEqual(['start db shop', 'run', 'stop']);
    expect(seen()!.command).toEqual(['npm', 'test']);
    expect(seen()!.env).toEqual({ PATH: '/bin', DATABASE_URL: 'postgres://postgres:shop@127.0.0.1:49153/postgres' });
  });

  it('gives back the exit code of the command and still stops the services', async () => {
    const { deps, events } = world(3);
    expect(await runWithServices({ file: good, command: ['npm', 'test'], project: 'shop' }, deps)).toBe(3);
    expect(events.at(-1)).toBe('stop');
  });

  it('stops the services when the command cannot be run', async () => {
    const { deps, events } = world(0, new Error('spawn npm ENOENT'));
    await expect(runWithServices({ file: good, command: ['npm', 'test'], project: 'shop' }, deps)).rejects.toThrow(
      'spawn npm ENOENT',
    );
    expect(events).toEqual(['start db shop', 'run', 'stop']);
  });

  it('refuses a file that is missing, not JSON or not a valid declaration, naming it, and starts nothing', async () => {
    const cases: [string, RegExp][] = [
      [join(dir, 'missing.json'), /missing\.json/],
      [file('broken.json', '{'), /broken\.json: not valid JSON/],
      [file('image.json', JSON.stringify({ db: { image: 'mysql:9' } })), /image\.json: services\.db\.image/],
    ];
    for (const [path, message] of cases) {
      const { deps, events } = world();
      await expect(runWithServices({ file: path, command: ['npm', 'test'], project: 'shop' }, deps)).rejects.toThrow(
        message,
      );
      expect(events).toEqual([]);
    }
  });

  it('refuses an empty command', async () => {
    const { deps, events } = world();
    await expect(runWithServices({ file: good, command: [], project: 'shop' }, deps)).rejects.toThrow(/command/);
    expect(events).toEqual([]);
  });
});
