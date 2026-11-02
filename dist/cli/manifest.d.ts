import type { ArchiveFile } from '../contract/archive.ts';
import type { ProjectManifest } from '../contract/manifest.ts';
declare const DIFFICULTIES: readonly ['beginner', 'intermediate', 'advanced'];
export interface ProjectInfo {
    id: string;
    name: string;
    difficulty?: (typeof DIFFICULTIES)[number];
}
/** bugDetective.project of the qa folder's package.json. */
export declare function readProject(qaDir: string): Promise<ProjectInfo>;
/** Files and folders every tickets/<id>/ must have. */
export declare const REQUIRED_TICKET_FILES: string[];
export declare const SEMVER: RegExp;
/**
 * Every committed file of the qa folder, read from disk with LF line endings (the content a
 * download of the qa branch gives, before it is published).
 */
export declare function readQaFiles(qaDir: string): Promise<ArchiveFile[]>;
export interface BuildManifestOptions {
    qaDir: string;
    version: string;
    now?: string;
}
/** Reads the qa folder and the ticket branches into a manifest. Writes nothing. */
export declare function buildManifest({ qaDir, version, now }: BuildManifestOptions): Promise<ProjectManifest>;
export {};
