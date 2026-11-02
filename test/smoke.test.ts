import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('projects.json', () => {
  it('lists SupportDesk first', async () => {
    const catalog = JSON.parse(await readFile(new URL('../projects.json', import.meta.url), 'utf8'));
    expect(catalog.projects[0].id).toBe('supportdesk');
  });
});
