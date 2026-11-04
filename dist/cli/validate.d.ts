import type { ProjectManifest } from '../contract/manifest.ts';
export interface ValidateLocalOptions {
    qaDir: string;
    /** Where the published manifest is: the base branch of the pull request. */
    baseRef?: string;
}
/**
 * The project workflow must call this repository's project.yml pinned by commit hash, with the
 * version in a comment that matches the @bug-detective/catalog dependency of the qa branch: the
 * checks and the CLI then come from the same version.
 */
export declare function workflowReferenceProblems(qaDir: string, ref?: string): Promise<string[]>;
export declare function validateLocal({ qaDir, baseRef }: ValidateLocalOptions): Promise<ProjectManifest>;
