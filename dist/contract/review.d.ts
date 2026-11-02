/**
 * Review configuration of a project (review.json at the root of its qa branch): the files left out
 * of the code comparison. Built-in defaults always apply on top of a project's list. The desktop
 * app turns it into path matchers and git pathspecs.
 */
import { z } from 'zod';
/** Applied to every project, even when its configuration or .gitignore forgets something. */
export declare const DEFAULT_EXCLUDES: readonly ['**/node_modules/**', '**/package-lock.json', '**/npm-shrinkwrap.json', '**/yarn.lock', '**/pnpm-lock.yaml', '**/bun.lockb', '**/*.db', '**/*.db-*', '**/*.sqlite*', '**/dist/**', '**/build/**', '**/coverage/**', '**/.env*', '**/*.log', '**/logs/**'];
/** Test files, left out only when a project sets "includeTests": false. */
export declare const TEST_GLOBS: readonly ['**/*.test.*', '**/*.spec.*', '**/__tests__/**'];
export declare const reviewConfigSchema: z.ZodObject<{
    exclude: z.ZodDefault<z.ZodArray<z.ZodString>>;
    includeTests: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export interface ReviewConfig {
    /** Project globs plus the built-in defaults, without duplicates. */
    exclude: string[];
    includeTests: boolean;
}
/** Validates a project's review.json (or nothing, for a project without one) and adds the defaults. */
export declare function parseReviewConfig(raw?: unknown): ReviewConfig;
