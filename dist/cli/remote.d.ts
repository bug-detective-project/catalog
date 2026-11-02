import type { ProjectManifest } from '../contract/manifest.ts';
export declare class HttpError extends Error {
    readonly status: number;
    constructor(url: string, status: number);
}
export type FetchZip = (url: string) => Promise<Uint8Array>;
export type LsRemoteTags = (repository: string) => Promise<Map<string, string>>;
export interface ValidateRemoteOptions {
    /** owner/name on GitHub. */
    repository: string;
    /** The branch or tag the content comes from. */
    ref?: string;
    /** The project id the manifest must have. */
    project?: string;
    fetchZip?: FetchZip;
    lsRemoteTags?: LsRemoteTags;
}
/** Downloads a zip, giving up after timeoutMs (a stalled download must not hang the daily check). */
export declare function fetchZipWithTimeout(timeoutMs: number): FetchZip;
export declare const fetchZipFromGitHub: FetchZip;
/** The tags of a public repository and the commit each one points to (annotated tags peeled). */
export declare const lsRemoteTagsFromGitHub: LsRemoteTags;
export declare function validateRemote({ repository, ref, project, fetchZip, lsRemoteTags, }: ValidateRemoteOptions): Promise<ProjectManifest>;
