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
