import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseCatalog, starterProject } from '../src/contract/index.ts';

describe('projects.json', () => {
  it('is a valid catalog that starts with SupportDesk', async () => {
    const catalog = parseCatalog(JSON.parse(await readFile(new URL('../projects.json', import.meta.url), 'utf8')));
    expect(starterProject(catalog).id).toBe('supportdesk');
  });
});
