/**
 * Review configuration of a project (review.json at the root of its qa branch): the files left out
 * of the code comparison. Built-in defaults always apply on top of a project's list. The desktop
 * app turns it into path matchers and git pathspecs.
 */
import { z } from 'zod';

/** Applied to every project, even when its configuration or .gitignore forgets something. */
export const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/package-lock.json',
  '**/npm-shrinkwrap.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  '**/bun.lockb',
  '**/*.db',
  '**/*.db-*',
  '**/*.sqlite*',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.env*',
  '**/*.log',
  '**/logs/**',
] as const;

/** Test files, left out only when a project sets "includeTests": false. */
export const TEST_GLOBS = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'] as const;

// Globs are relative POSIX paths made of plain path characters and *, ? (no leading slash, no "..").
const glob = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_.*?@+\-/]+$/)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), 'Globs must be relative paths');

export const reviewConfigSchema = z.object({
  exclude: z.array(glob).max(200).default([]),
  includeTests: z.boolean().default(true),
});

export interface ReviewConfig {
  /** Project globs plus the built-in defaults, without duplicates. */
  exclude: string[];
  includeTests: boolean;
}

/** Validates a project's review.json (or nothing, for a project without one) and adds the defaults. */
export function parseReviewConfig(raw: unknown = {}): ReviewConfig {
  const parsed = reviewConfigSchema.parse(raw);
  const exclude = [...DEFAULT_EXCLUDES, ...parsed.exclude, ...(parsed.includeTests ? [] : TEST_GLOBS)];
  return { exclude: [...new Set(exclude)], includeTests: parsed.includeTests };
}
