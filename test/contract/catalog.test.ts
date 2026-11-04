import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { InvalidCatalogError, appSupports, parseCatalog, starterProject } from '../../src/contract/catalog.ts';

const project = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  repository: `bug-detective-project/${id}`,
  ...extra,
});
const catalog = (...projects: unknown[]) => ({ projects });

describe('projects catalog', () => {
  it('accepts the projects.json of this repository', async () => {
    const parsed = parseCatalog(JSON.parse(await readFile(new URL('../../projects.json', import.meta.url), 'utf8')));
    expect(starterProject(parsed).id).toBe('supportdesk');
  });

  it('defaults qaRef to qa and starter to false', () => {
    const parsed = parseCatalog(catalog(project('a', { starter: true }), project('b')));
    expect(parsed.projects[0].qaRef).toBe('qa');
    expect(parsed.projects[1]).toMatchObject({ qaRef: 'qa', starter: false });
  });

  it('keeps a qaRef, a minimum app version and a hidden flag', () => {
    const parsed = parseCatalog(
      catalog(
        project('a', { starter: true }),
        project('b', { qaRef: 'qa-v2.4.0', minAppVersion: '2.0.0', hidden: true }),
      ),
    );
    expect(parsed.projects[1]).toMatchObject({ qaRef: 'qa-v2.4.0', minAppVersion: '2.0.0', hidden: true });
  });

  it.each([
    ['no starter', catalog(project('a'), project('b')), /exactly one/],
    ['two starters', catalog(project('a', { starter: true }), project('b', { starter: true })), /exactly one/],
    ['a repeated id', catalog(project('a', { starter: true }), project('a')), /listed twice/],
    ['a hidden starter', catalog(project('a', { starter: true, hidden: true })), /starter cannot be hidden/],
    ['a repository without owner', catalog({ id: 'a', repository: 'supportdesk', starter: true }), /repository/],
    [
      'a repository outside the organization',
      catalog({ id: 'a', repository: 'octocat/supportdesk', starter: true }),
      /bug-detective-project\/<name>/,
    ],
    [
      'a minimum app version that is not X.Y.Z',
      catalog(project('a', { starter: true, minAppVersion: '1.2' })),
      /minAppVersion/,
    ],
    ['an uppercase id', catalog(project('Support', { starter: true })), /id/],
    ['no projects', catalog(), /projects/],
  ])('refuses %s', (_name, raw, message) => {
    expect(() => parseCatalog(raw)).toThrow(InvalidCatalogError);
    expect(() => parseCatalog(raw)).toThrow(message);
  });

  it('tells whether this app version can play a project', () => {
    const [needsTwo] = parseCatalog(catalog(project('a', { starter: true, minAppVersion: '2.0.0' }))).projects;
    expect(appSupports(needsTwo, '1.9.9')).toBe(false);
    expect(appSupports(needsTwo, '2.0.0')).toBe(true);
    const [any] = parseCatalog(catalog(project('a', { starter: true }))).projects;
    expect(appSupports(any, '0.1.0')).toBe(true);
  });
});
