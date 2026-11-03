import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  installScriptProblems,
  lockfileOriginProblems,
  npmrcProblems,
  packageName,
  releaseAgeProblems,
} from '../../src/cli/dependencies.ts';
import type { Lockfile } from '../../src/cli/dependencies.ts';

const registry = 'https://registry.npmjs.org/';
const lock = (packages: Lockfile['packages']): Lockfile => ({ lockfileVersion: 3, packages: { '': {}, ...packages } });
const pkg = (name: string, version: string, extra: object = {}) => ({
  version,
  resolved: `${registry}${name}/-/${name.split('/').pop()}-${version}.tgz`,
  integrity: `sha512-${name}`,
  ...extra,
});

describe('lockfileOriginProblems', () => {
  it('accepts registry packages with integrity, and ignores the root and workspace links', () => {
    const problems = lockfileOriginProblems(
      lock({
        client: { link: true },
        'node_modules/express': pkg('express', '5.3.0'),
        'node_modules/@types/node': pkg('@types/node', '26.6.5'),
      }),
    );
    expect(problems).toEqual([]);
  });

  it('names a package from git, from another host or without integrity', () => {
    const problems = lockfileOriginProblems(
      lock({
        'node_modules/left-pad': {
          version: '1.0.0',
          resolved: 'git+https://github.com/x/left-pad.git#abc',
          integrity: 'sha512-x',
        },
        'node_modules/odd': {
          version: '1.0.0',
          resolved: 'https://npm.example.com/odd/-/odd-1.0.0.tgz',
          integrity: 'sha512-x',
        },
        'node_modules/bare': { version: '1.0.0', resolved: `${registry}bare/-/bare-1.0.0.tgz` },
      }),
    );
    expect(problems).toEqual([
      expect.stringMatching(/^left-pad comes from git\+https:\/\/github\.com\/x\/left-pad\.git#abc/),
      expect.stringMatching(/^odd comes from https:\/\/npm\.example\.com/),
      'bare has no integrity hash in the lockfile',
    ]);
  });

  it('names scoped and nested packages by their package name', () => {
    expect(packageName('node_modules/@scope/name')).toBe('@scope/name');
    expect(packageName('node_modules/a/node_modules/b')).toBe('b');
  });
});

describe('installScriptProblems', () => {
  const withScript = lock({
    'node_modules/better-sqlite3': pkg('better-sqlite3', '13.0.3', { hasInstallScript: true }),
    'node_modules/esbuild': pkg('esbuild', '0.25.0', { hasInstallScript: true }),
  });

  it('accepts an allowed package with a script, and a package with a script that is not allowed (npm will not run it)', () => {
    expect(installScriptProblems(withScript, { allowScripts: { 'better-sqlite3@13.0.3': true } })).toEqual([]);
    expect(installScriptProblems(withScript, {})).toEqual([]);
  });

  it('refuses allowing a package outside the list, and allowing one that has no script', () => {
    const problems = installScriptProblems(withScript, {
      allowScripts: { 'esbuild@0.25.0': true, 'better-sqlite3@13.0.3': true },
    });
    expect(problems).toEqual([
      expect.stringMatching(/esbuild@0\.25\.0, which is not in the catalog's list \(better-sqlite3\)/),
    ]);
    expect(
      installScriptProblems(lock({ 'node_modules/better-sqlite3': pkg('better-sqlite3', '13.0.3') }), {
        allowScripts: { 'better-sqlite3@13.0.3': true },
      }),
    ).toEqual([expect.stringMatching(/the lockfile says it has none/)]);
  });

  it('handles scoped package specs', () => {
    expect(installScriptProblems(lock({}), { allowScripts: { '@scope/tool@1.0.0': true } })).toEqual([
      expect.stringMatching(/@scope\/tool@1\.0\.0, which is not/),
    ]);
  });
});

describe('npmrcProblems', () => {
  it('accepts the required keys in any order, with comments', () => {
    expect(npmrcProblems('# locked down\nmin-release-age=7\nallow-remote=none\nallow-git = none\n')).toEqual([]);
  });

  it('names a missing file, a missing key and a wrong value', () => {
    expect(npmrcProblems(undefined)).toEqual([
      expect.stringMatching(/^\.npmrc is missing: it must set allow-git=none, allow-remote=none, min-release-age=7/),
    ]);
    expect(npmrcProblems('allow-git=none\nmin-release-age=3\n')).toEqual([
      '.npmrc must set allow-remote=none (found nothing)',
      '.npmrc must set min-release-age=7 (found min-release-age=3)',
    ]);
  });
});

describe('releaseAgeProblems', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const registryOf = (times: Record<string, Record<string, string>>) => async (url: string) => {
    const name = url.slice(registry.length);
    if (!(name in times)) throw new Error('HTTP 404');
    return { time: times[name] };
  };

  it('accepts versions older than the minimum age and refuses newer ones, naming the date', async () => {
    const problems = await releaseAgeProblems(
      lock({ 'node_modules/old': pkg('old', '1.0.0'), 'node_modules/fresh': pkg('fresh', '2.0.0') }),
      registryOf({ old: { '1.0.0': '2026-10-20T00:00:00Z' }, fresh: { '2.0.0': '2026-10-30T00:00:00Z' } }),
      now,
    );
    expect(problems).toEqual([
      'fresh@2.0.0 was published on 2026-10-30, less than 7 days ago: wait, or use an older version',
    ]);
  });

  it('asks the registry once per package and skips, with a log line, what it cannot read', async () => {
    const urls: string[] = [];
    const lines: string[] = [];
    const problems = await releaseAgeProblems(
      lock({
        'node_modules/a': pkg('a', '1.0.0'),
        'node_modules/x/node_modules/a': pkg('a', '1.0.0'),
        'node_modules/gone': pkg('gone', '1.0.0'),
      }),
      async (url) => {
        urls.push(url);
        return registryOf({ a: { '1.0.0': '2020-01-01T00:00:00Z' } })(url);
      },
      now,
      (line) => lines.push(line),
    );
    expect(problems).toEqual([]);
    expect(urls.filter((url) => url.endsWith('/a'))).toHaveLength(1);
    expect(lines.join('\n')).toMatch(/gone: could not read its release dates/);
  });
});

describe('the real SupportDesk lockfile', () => {
  const supportdesk = resolve(import.meta.dirname, '..', '..', '..', 'supportdesk');
  it.skipIf(!existsSync(join(supportdesk, 'package-lock.json')))(
    'passes the origin and install-script rules',
    async () => {
      const lockfile = JSON.parse(await readFile(join(supportdesk, 'package-lock.json'), 'utf8')) as Lockfile;
      const packageJson = JSON.parse(await readFile(join(supportdesk, 'package.json'), 'utf8')) as {
        allowScripts?: Record<string, boolean>;
      };
      expect(lockfileOriginProblems(lockfile)).toEqual([]);
      expect(installScriptProblems(lockfile, packageJson)).toEqual([]);
    },
  );
});
