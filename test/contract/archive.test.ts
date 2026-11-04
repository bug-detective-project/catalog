import { describe, expect, it } from 'vitest';
import {
  UnsafeArchiveError,
  assertNoCaseCollisions,
  readZip,
  safeRelativePath,
  textFile,
  treeDigest,
  writeZip,
} from '../../src/contract/archive.ts';

describe('treeDigest', () => {
  const files = [textFile('b.txt', 'b\n'), textFile('a/c.txt', 'c\n')];

  it('does not depend on the order of the files', () => {
    expect(treeDigest(files)).toBe(treeDigest([...files].reverse()));
    expect(treeDigest(files)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes when one byte changes', () => {
    expect(treeDigest([textFile('b.txt', 'B\n'), files[1]])).not.toBe(treeDigest(files));
  });
});

describe('safeRelativePath', () => {
  it.each(['../a', '/a', 'C:/a', 'a\\b', 'a//b', ''])('refuses %j', (path) => {
    expect(() => safeRelativePath(path)).toThrow(UnsafeArchiveError);
  });

  it.each([
    'tests/a:b.txt',
    'con',
    'CON.txt',
    'tests/aux.ts',
    'nul.json',
    'com1.txt',
    'lpt9',
    'notes.',
    'notes /x',
    'a<b',
    'a>b',
    'a"b',
    'a|b',
    'a?b',
    'a*b',
    'a\u0001b',
  ])('refuses %j, which Windows cannot store', (path) => {
    expect(() => safeRelativePath(path)).toThrow(UnsafeArchiveError);
  });

  it.each([
    'config.json',
    'console.ts',
    'src/components/Auxiliary.tsx',
    'a.b.c',
    'com10.txt',
    'prn-report.md',
    'nulled/x.ts',
  ])('accepts %j', (path) => {
    expect(safeRelativePath(path)).toBe(path);
  });

  it('drops a leading ./', () => {
    expect(safeRelativePath('./a/b')).toBe('a/b');
  });
});

describe('assertNoCaseCollisions', () => {
  it('refuses two paths that differ only by case, naming both', () => {
    expect(() => assertNoCaseCollisions([{ path: 'src/A.ts' }, { path: 'src/b.ts' }, { path: 'src/a.ts' }])).toThrow(
      /"src\/A\.ts" and "src\/a\.ts"/,
    );
  });

  it('accepts distinct paths and the same path listed twice', () => {
    expect(() => assertNoCaseCollisions([{ path: 'a.ts' }, { path: 'b.ts' }, { path: 'a.ts' }])).not.toThrow();
  });

  it('is applied when a zip is read', () => {
    const zip = writeZip([
      { path: 'A.ts', data: new Uint8Array([1]), executable: false },
      { path: 'a.ts', data: new Uint8Array([2]), executable: false },
    ]);
    expect(() => readZip(zip)).toThrow(UnsafeArchiveError);
  });
});

describe('zip', () => {
  it('reads back what it writes', () => {
    const files = [textFile('a.txt', 'a\n'), textFile('dir/b.txt', 'b\n')];
    const read = readZip(writeZip(files));
    expect(read.map((file) => [file.path, Buffer.from(file.data).toString()])).toEqual([
      ['a.txt', 'a\n'],
      ['dir/b.txt', 'b\n'],
    ]);
  });

  it('refuses a zip with more entries than the limit', () => {
    const zip = writeZip([textFile('a.txt', 'a'), textFile('b.txt', 'b')]);
    expect(() => readZip(zip, { maxBytes: 1024, maxEntries: 1 })).toThrow();
  });
});
