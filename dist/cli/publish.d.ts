import type { ProjectManifest } from '../contract/manifest.ts';
export interface PublishOptions {
    qaDir: string;
    version: string;
    /** owner/name on GitHub; by default, from the origin remote. */
    repository?: string;
    dryRun?: boolean;
    /** Push the ticket branches, the tags and the work branch (default true). */
    push?: boolean;
    log: (line: string) => void;
}
/** owner/name of a GitHub remote URL (SSH or HTTPS). */
export declare function repositoryFromRemote(url: string): string;
export declare function publishProject(options: PublishOptions): Promise<{
    manifest: ProjectManifest;
    prUrl: string;
}>;
