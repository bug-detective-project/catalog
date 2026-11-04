import type { TextFile } from '../contract/policy.ts';
import type { ProjectManifest } from '../contract/manifest.ts';
import type { FetchJson } from './dependencies.ts';
type Log = (line: string) => void;
export interface ValidateLocalOptions {
    qaDir: string;
    /** Where the published manifest is: the base branch of the pull request. */
    baseRef?: string;
    /** Skip the checks that need the network (the release ages of the dependencies). */
    offline?: boolean;
    fetchJson?: FetchJson;
    log?: (line: string) => void;
}
/**
 * The project workflow must call this repository's project.yml pinned by commit hash, with the
 * version in a comment that matches the @bug-detective/catalog dependency of the qa branch: the
 * checks and the CLI then come from the same version.
 */
export declare function workflowReferenceProblems(qaDir: string, ref?: string, log?: Log): Promise<string[]>;
/** The player-facing texts of the committed qa folder: markdown as is, JSON as its strings. */
export declare function projectTexts(qaDir: string): Promise<TextFile[]>;
/** The .vscode/ files of main and of every ticket branch, per branch. */
export declare function vscodeFilesOf(qaDir: string, branches: readonly string[]): Promise<{
    branch: string;
    files: TextFile[];
}[]>;
/** The policy checks of a publication: VS Code files and extensions, and dangerous commands in the texts. */
export declare function policyProblems(qaDir: string, branches: readonly string[], log?: Log): Promise<string[]>;
/**
 * The dependency checks of main and of every ticket branch: origins and integrity, allowed
 * install scripts, the .npmrc, and (with the network) the release ages. A branch without a
 * lockfile has no dependencies and nothing to check.
 */
export declare function dependencyProblems(qaDir: string, branches: readonly string[], options?: {
    offline?: boolean;
    fetchJson?: FetchJson;
    log?: (line: string) => void;
}): Promise<string[]>;
export declare function validateLocal({ qaDir, baseRef, offline, fetchJson, log, }: ValidateLocalOptions): Promise<ProjectManifest>;
export {};
