import { Readable } from 'node:stream';
export interface ArchiveFile {
    /** POSIX relative path, validated by safeRelativePath. */
    path: string;
    data: Uint8Array;
    executable: boolean;
}
export declare class UnsafeArchiveError extends Error {
}
/** Validates an archive entry path: relative, no `..`, no drive letters or backslashes. */
export declare function safeRelativePath(raw: string): string;
export declare function sha256Hex(data: Uint8Array | string): string;
/**
 * Digest of a set of files that does not depend on the archive format: SHA-256 over the sorted
 * lines "<sha256 of content>  <path>". The same tree gives the same digest from git archive,
 * a GitHub zip or an extracted folder.
 */
export declare function treeDigest(files: readonly ArchiveFile[]): string;
/** Reads the regular files of a tar archive (for example `git archive --format=tar`). */
export declare function readTar(input: Uint8Array | Readable): Promise<ArchiveFile[]>;
/** Writes files as a tar archive (used to stream a snapshot into the workspace container). */
export declare function writeTar(files: readonly ArchiveFile[]): Promise<Buffer>;
/** Defaults of readZip's limits: far above any stage package or save, far below what would exhaust memory. */
export declare const ZIP_LIMITS: {
    maxBytes: number;
    maxEntries: number;
};
/**
 * Reads a zip archive. With `stripTopDirectory`, the single top-level folder that GitHub puts in
 * branch archives (`repo-branch/`) is removed from every path. The sizes the archive declares are
 * checked before anything is extracted (a zip bomb is refused, not inflated): fflate allocates each
 * entry at its declared size and never writes past it.
 */
export declare function readZip(bytes: Uint8Array, options?: {
    stripTopDirectory?: boolean;
    maxBytes?: number;
    maxEntries?: number;
}): ArchiveFile[];
/** Writes a deterministic zip: sorted entries and a fixed timestamp, so the checksum is stable. */
export declare function writeZip(files: readonly ArchiveFile[]): Uint8Array;
export declare function textFile(path: string, text: string): ArchiveFile;
export declare function fileText(file: ArchiveFile): string;
