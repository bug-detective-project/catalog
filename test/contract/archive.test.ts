import { describe, expect, it } from 'vitest';
import {
  UnsafeArchiveError,
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

  it('drops a leading ./', () => {
    expect(safeRelativePath('./a/b')).toBe('a/b');
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
