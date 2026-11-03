import type { ProjectManifest } from '../contract/manifest.ts';
export interface PublishOptions {
    qaDir: string;
    version: string;
    /** owner/name on GitHub; by default, from the origin remote. */
    repository?: string;
    dryRun?: boolean;
    /** Push the ticket branches and the work branch (default true). */
    push?: boolean;
    log: (line: string) => void;
}
/** owner/name of a GitHub remote URL (SSH or HTTPS). */
export declare function repositoryFromRemote(url: string): string;
export declare function publishProject(options: PublishOptions): Promise<{
    manifest: ProjectManifest;
    prUrl: string;
}>;
export interface AbortOptions {
    qaDir: string;
    version: string;
    log: (line: string) => void;
}
/**
 * bd publish --abort: undoes the local publication of `version` on the work branch (the "Publish"
 * commit and the manifest it wrote), as long as that commit was never pushed. Local ticket tags of
 * that version left by older versions of bd are removed too.
 */
export declare function abortPublication({ qaDir, version, log }: AbortOptions): Promise<void>;
