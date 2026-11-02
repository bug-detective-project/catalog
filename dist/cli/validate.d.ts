import type { ProjectManifest } from '../contract/manifest.ts';
export interface ValidateLocalOptions {
    qaDir: string;
    /** Where the published manifest is: the base branch of the pull request. */
    baseRef?: string;
}
export declare function validateLocal({ qaDir, baseRef }: ValidateLocalOptions): Promise<ProjectManifest>;
