import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkCatalog } from '../../src/cli/catalog-check.ts';
import type { ValidateRemoteOptions } from '../../src/cli/remote.ts';

let dir: string;
let file: string;
const checked: ValidateRemoteOptions[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bd-catalog-'));
  file = join(dir, 'projects.json');
  checked.length = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const project = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  repository: `bug-detective-project/${id}`,
  ...extra,
});

describe('bd catalog-check', () => {
  it('validates every listed project at its qaRef', async () => {
    await writeFile(
      file,
      JSON.stringify({ projects: [project('a', { starter: true }), project('b', { qaRef: 'qa-next' })] }),
    );
    await checkCatalog({ file, validate: async (options) => void checked.push(options) as never });
    expect(checked.map(({ repository, ref, project }) => [repository, ref, project])).toEqual([
      ['bug-detective-project/a', 'qa', 'a'],
      ['bug-detective-project/b', 'qa-next', 'b'],
    ]);
  });

  it('refuses an invalid catalog without downloading anything', async () => {
    await writeFile(file, JSON.stringify({ projects: [project('a')] }));
    await expect(
      checkCatalog({ file, validate: async (options) => void checked.push(options) as never }),
    ).rejects.toThrow(/starter/);
    expect(checked).toEqual([]);
  });

  it('checks every project and names only the broken ones', async () => {
    await writeFile(file, JSON.stringify({ projects: [project('a', { starter: true }), project('b'), project('c')] }));
    const validate = async ({ project: id }: ValidateRemoteOptions) => {
      if (id === 'b') throw new Error('b: the tag front-1-v1.0.0 is not published');
      return undefined as never;
    };
    const error = await checkCatalog({ file, validate }).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('b: the tag front-1-v1.0.0 is not published');
    expect((error as Error).message).not.toMatch(/\ba:|\bc:/);
  });
});

describe('bd catalog-check, the order and the app version', () => {
  type Level = 'beginner' | 'intermediate' | 'advanced';
  const manifests: Record<string, { difficulty?: Level; types?: (string | undefined)[]; services?: object }> = {};
  const validate = async ({ project }: ValidateRemoteOptions) => {
    const id = project ?? '';
    return {
      project: { id, name: id, difficulty: manifests[id]?.difficulty, services: manifests[id]?.services },
      entries: (manifests[id]?.types ?? [undefined]).map((type) => ({ type })),
    } as never;
  };
  const check = (projects: unknown[]) =>
    writeFile(file, JSON.stringify({ projects })).then(() => checkCatalog({ file, validate }));
  const levels = (list: Record<string, Level | undefined>) => {
    for (const key of Object.keys(manifests)) delete manifests[key];
    for (const [id, difficulty] of Object.entries(list)) manifests[id] = { difficulty };
  };

  it('accepts the starter first and then levels that never go down', async () => {
    levels({ a: 'advanced', b: 'beginner', c: 'beginner', d: 'intermediate', e: 'advanced' });
    await expect(
      check([project('a', { starter: true }), project('b'), project('c'), project('d'), project('e')]),
    ).resolves.toBeUndefined();
  });

  it('refuses a project listed after a higher level, naming it', async () => {
    levels({ a: 'beginner', b: 'advanced', c: 'intermediate' });
    await expect(check([project('a', { starter: true }), project('b'), project('c')])).rejects.toThrow(
      'c: listed out of level order (intermediate after advanced)',
    );
  });

  it('lets a project without a level keep the order', async () => {
    levels({ a: 'beginner', b: 'intermediate', c: undefined, d: 'intermediate' });
    await expect(
      check([project('a', { starter: true }), project('b'), project('c'), project('d')]),
    ).resolves.toBeUndefined();
  });

  it('refuses a starter that is not the first project', async () => {
    levels({ a: 'beginner', b: 'beginner' });
    await expect(check([project('a'), project('b', { starter: true })])).rejects.toThrow(
      'b: the starter must be the first project',
    );
  });

  it('requires minAppVersion 1.1.0 of a project with tickets of other types', async () => {
    levels({ a: 'beginner', b: 'beginner' });
    manifests.b.types = ['fix', 'build'];
    const message = 'b: has tickets of other types and needs minAppVersion >= 1.1.0';
    await expect(check([project('a', { starter: true }), project('b')])).rejects.toThrow(message);
    await expect(check([project('a', { starter: true }), project('b', { minAppVersion: '1.0.0' })])).rejects.toThrow(
      message,
    );
    await expect(
      check([project('a', { starter: true }), project('b', { minAppVersion: '1.1.0' })]),
    ).resolves.toBeUndefined();
  });

  it('requires minAppVersion 1.2.0 of a project that declares services', async () => {
    levels({ a: 'beginner', b: 'beginner' });
    manifests.b.services = { db: { image: 'postgres:17' } };
    const message = 'b: declares services and needs minAppVersion >= 1.2.0';
    await expect(check([project('a', { starter: true }), project('b')])).rejects.toThrow(message);
    await expect(check([project('a', { starter: true }), project('b', { minAppVersion: '1.1.0' })])).rejects.toThrow(
      message,
    );
    await expect(
      check([project('a', { starter: true }), project('b', { minAppVersion: '1.2.0' })]),
    ).resolves.toBeUndefined();
  });

  it('requires minAppVersion 1.4.0 of a project with service arguments', async () => {
    levels({ a: 'beginner', b: 'beginner' });
    manifests.b.services = { cache: { image: 'redis:8', args: ['--requirepass', 'cartworks'] } };
    const message = 'b: declares service arguments and needs minAppVersion >= 1.4.0';
    await expect(check([project('a', { starter: true }), project('b', { minAppVersion: '1.3.0' })])).rejects.toThrow(
      message,
    );
    await expect(
      check([project('a', { starter: true }), project('b', { minAppVersion: '1.4.0' })]),
    ).resolves.toBeUndefined();
  });

  it('requires 1.4.0 for an empty list of arguments too: an older app refuses the field itself', async () => {
    levels({ a: 'beginner', b: 'beginner' });
    manifests.b.services = { db: { image: 'postgres:17', args: [] } };
    await expect(check([project('a', { starter: true }), project('b', { minAppVersion: '1.2.0' })])).rejects.toThrow(
      'b: declares service arguments and needs minAppVersion >= 1.4.0',
    );
    await expect(
      check([project('a', { starter: true }), project('b', { minAppVersion: '1.4.0' })]),
    ).resolves.toBeUndefined();
  });

  it('requires the first app version that knows the image of each service', async () => {
    levels({ a: 'beginner', b: 'beginner' });
    manifests.b.services = { cache: { image: 'redis:8' } };
    await expect(check([project('a', { starter: true }), project('b', { minAppVersion: '1.3.0' })])).rejects.toThrow(
      'b: uses the image redis:8 and needs minAppVersion >= 1.4.0',
    );
    await expect(
      check([project('a', { starter: true }), project('b', { minAppVersion: '1.4.0' })]),
    ).resolves.toBeUndefined();

    manifests.b.services = { db: { image: 'mysql:8.4' } };
    await expect(check([project('a', { starter: true }), project('b', { minAppVersion: '1.2.0' })])).rejects.toThrow(
      'b: uses the image mysql:8.4 and needs minAppVersion >= 1.3.0',
    );
    await expect(
      check([project('a', { starter: true }), project('b', { minAppVersion: '1.3.0' })]),
    ).resolves.toBeUndefined();
  });

  it('asks no app version of a project with an empty services declaration', async () => {
    levels({ a: 'beginner' });
    manifests.a.services = {};
    await expect(check([project('a', { starter: true })])).resolves.toBeUndefined();
  });

  it('asks nothing of a project with fix tickets only', async () => {
    levels({ a: 'beginner' });
    manifests.a.types = ['fix', undefined];
    await expect(check([project('a', { starter: true })])).resolves.toBeUndefined();
  });
});
