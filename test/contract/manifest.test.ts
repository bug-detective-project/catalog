import { describe, expect, it } from 'vitest';
import {
  ContentVerificationError,
  SUPPORTED_FORMAT_VERSION,
  UnsupportedFormatError,
  compareVersions,
  parseManifest,
} from '../../src/contract/manifest.ts';

const digest = (char: string) => `sha256:${char.repeat(64)}`;

function entry(track: 'front' | 'back', order: number) {
  const id = `${track}-${order}`;
  return {
    id,
    track,
    order,
    branch: id,
    tag: `${id}-v1.0.0`,
    commit: 'a'.repeat(40),
    commitMessage: `Project release ${id}`,
    codeDigest: digest('b'),
    codeFiles: 10,
    package: { path: `tickets/${id}`, files: 12, digest: digest('c') },
  };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    format: 'bug-detective-project',
    formatVersion: 1,
    project: { id: 'supportdesk', name: 'SupportDesk' },
    version: '1.0.0',
    createdAt: '2026-11-02T10:00:00.000Z',
    tickets: { total: 3, front: 2, back: 1 },
    entries: [entry('front', 1), entry('front', 2), entry('back', 1)],
    ...overrides,
  };
}

describe('project manifest', () => {
  it('accepts a valid manifest', () => {
    expect(parseManifest(manifest(), 'supportdesk').tickets.total).toBe(3);
  });

  it('rejects a manifest of another project', () => {
    expect(() => parseManifest(manifest(), 'other')).toThrow(/another project/);
  });

  it('rejects a total that is not front + back', () => {
    expect(() => parseManifest(manifest({ tickets: { total: 4, front: 2, back: 1 } }))).toThrow(/total/);
  });

  it('rejects counts that do not match the entries', () => {
    expect(() => parseManifest(manifest({ tickets: { total: 4, front: 3, back: 1 } }))).toThrow(/front/);
  });

  it('rejects a gap in a track order', () => {
    const entries = [entry('front', 1), entry('front', 3), entry('back', 1)];
    expect(() => parseManifest(manifest({ entries }))).toThrow(/order/);
  });

  it('rejects a repeated order', () => {
    const entries = [entry('front', 1), entry('front', 1), entry('back', 1)];
    expect(() => parseManifest(manifest({ entries }))).toThrow(/order/);
  });

  it('rejects an id that is not track-order', () => {
    const entries = [entry('front', 1), { ...entry('front', 2), id: 'front-9' }, entry('back', 1)];
    expect(() => parseManifest(manifest({ entries }))).toThrow(/id/);
  });

  it('rejects back tickets before front tickets', () => {
    const entries = [entry('back', 1), entry('front', 1), entry('front', 2)];
    expect(() => parseManifest(manifest({ entries }))).toThrow(/order/);
  });

  it('rejects a project without tickets', () => {
    expect(() => parseManifest(manifest({ tickets: { total: 0, front: 0, back: 0 }, entries: [] }))).toThrow(
      ContentVerificationError,
    );
  });

  it('rejects an invalid project id', () => {
    expect(() => parseManifest(manifest({ project: { id: 'Support Desk', name: 'SupportDesk' } }))).toThrow(
      ContentVerificationError,
    );
  });

  it('rejects a package path outside tickets/<id>', () => {
    const entries = [
      entry('front', 1),
      { ...entry('front', 2), package: { ...entry('front', 2).package, path: 'tickets/front-1' } },
      entry('back', 1),
    ];
    expect(() => parseManifest(manifest({ entries }))).toThrow(/path/);
  });

  it('says to update the app for a newer content format', () => {
    const error = (() => {
      try {
        parseManifest(manifest({ formatVersion: SUPPORTED_FORMAT_VERSION + 1 }));
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).formatVersion).toBe(2);
    expect((error as Error).message).toMatch(/update Bug Detective/);
  });

  it.each([{ formatVersion: 0 }, { format: 'other' }])('rejects %j as invalid, not as a newer format', (overrides) => {
    let error: unknown;
    try {
      parseManifest(manifest(overrides));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ContentVerificationError);
    expect(error).not.toBeInstanceOf(UnsupportedFormatError);
  });

  it('compares X.Y.Z versions numerically', () => {
    expect(compareVersions('2.10.0', '2.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
  });
});
