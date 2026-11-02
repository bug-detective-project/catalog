import { describe, expect, it } from 'vitest';
import { DEFAULT_EXCLUDES, TEST_GLOBS, parseReviewConfig } from '../../src/contract/review.ts';

describe('review configuration', () => {
  it('always applies the built-in defaults, even without a project file', () => {
    const config = parseReviewConfig();
    expect(config.exclude).toEqual([...DEFAULT_EXCLUDES]);
    expect(config.includeTests).toBe(true);
  });

  it('adds the project globs to the defaults without duplicates', () => {
    const config = parseReviewConfig({ exclude: ['**/tmp/**', '**/node_modules/**'] });
    expect(config.exclude).toEqual([...DEFAULT_EXCLUDES, '**/tmp/**']);
  });

  it('adds the test globs when the project leaves tests out', () => {
    expect(parseReviewConfig({ includeTests: false }).exclude).toEqual([...DEFAULT_EXCLUDES, ...TEST_GLOBS]);
  });

  it('rejects absolute paths, parent folders and shell characters', () => {
    for (const exclude of ['/etc/**', '../secrets/**', 'a;rm -rf', '$(id)', 'a b']) {
      expect(() => parseReviewConfig({ exclude: [exclude] })).toThrow();
    }
  });
});
