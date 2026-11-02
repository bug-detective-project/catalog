import type { ArchiveFile } from '../contract/archive.ts';
export interface Git {
    /** Runs git in the folder and returns its trimmed output; fails on a non-zero exit. */
    text(...args: string[]): Promise<string>;
}
export declare function gitIn(dir: string): Git;
/** `git archive` of a ref, with line-ending conversion disabled so files keep LF on Windows. */
export declare function gitArchive(dir: string, ref: string): Promise<ArchiveFile[]>;
/** The ref of a ticket branch: the local `<id>`, or `origin/<id>` in a fresh clone or on CI. */
export declare function resolveBranchRef(dir: string, branch: string): Promise<string>;
/**
 * Text files are normalized to LF: a Windows checkout with core.autocrlf=true has CRLF in its
 * working tree, and the package must be byte-identical on every platform (and git apply needs LF).
 */
export declare function normalizeLineEndings(data: Buffer): Buffer;
