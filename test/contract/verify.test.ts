import { describe, expect, it } from 'vitest';
import { textFile, treeDigest } from '../../src/contract/archive.ts';
import { ContentVerificationError, parseManifest } from '../../src/contract/manifest.ts';
import type { TicketEntry } from '../../src/contract/manifest.ts';
import { TicketNotPublishedError, entryById, packageOf, verifyCode, verifyPackage } from '../../src/contract/verify.ts';

const packageFiles = [textFile('ticket.en.md', '# 1\n'), textFile('gate2/a.spec.ts', 'spec\n')];
const codeFiles = [textFile('app.ts', 'bug\n')];

const entry: TicketEntry = {
  id: 'front-1',
  track: 'front',
  order: 1,
  branch: 'front-1',
  tag: 'front-1-v1.0.0',
  commit: 'a'.repeat(40),
  commitMessage: 'Demo release front-1',
  codeDigest: treeDigest(codeFiles),
  codeFiles: 1,
  package: { path: 'tickets/front-1', files: 2, digest: treeDigest(packageFiles) },
};

describe('verification against the manifest', () => {
  it('accepts the package and the code the manifest describes', () => {
    expect(verifyPackage(entry, packageFiles)).toBe(packageFiles);
    expect(verifyCode(entry, codeFiles)).toBe(codeFiles);
  });

  it('refuses an extra file and a changed byte', () => {
    expect(() => verifyPackage(entry, [...packageFiles, textFile('extra.md', 'x')])).toThrow(ContentVerificationError);
    expect(() => verifyCode(entry, [textFile('app.ts', 'Bug\n')])).toThrow(/front-1/);
  });

  it('takes a ticket package out of the qa files, without the tickets/<id>/ prefix or bug.patch', () => {
    const qaFiles = [
      textFile('run.ts', 'cli\n'),
      textFile('tickets/front-1/ticket.en.md', '# 1\n'),
      textFile('tickets/front-1/gate2/a.spec.ts', 'spec\n'),
      textFile('tickets/front-1/bug.patch', 'diff\n'),
      textFile('tickets/front-2/ticket.en.md', '# 2\n'),
    ];
    expect(packageOf(entry, qaFiles).map((file) => file.path)).toEqual(['ticket.en.md', 'gate2/a.spec.ts']);
  });

  it('reports a ticket id the manifest does not have, with the counts per track', () => {
    const manifest = parseManifest({
      format: 'bug-detective-project',
      formatVersion: 1,
      project: { id: 'demo', name: 'Demo' },
      version: '1.0.0',
      createdAt: '2026-11-02T10:00:00.000Z',
      tickets: { total: 1, front: 1, back: 0 },
      entries: [entry],
    });
    expect(entryById(manifest, 'front-1')).toEqual(entry);
    let error: unknown;
    try {
      entryById(manifest, 'back-1');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TicketNotPublishedError);
    expect((error as TicketNotPublishedError).counts).toEqual({ front: 1, back: 0 });
  });
});
