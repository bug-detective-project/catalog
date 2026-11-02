import type { ArchiveFile } from './archive.ts';
import { ContentVerificationError } from './manifest.ts';
import type { ProjectManifest, Track, TicketEntry } from './manifest.ts';
/** How many tickets each track has. */
export type TrackCounts = Record<Track, number>;
/** The publication is not usable (a ticket commit or tag is missing, or it is older than allowed). */
export declare class IncompletePublicationError extends ContentVerificationError {
}
/** The published manifest has no ticket with that id (a newer publication with fewer tickets). */
export declare class TicketNotPublishedError extends ContentVerificationError {
    readonly counts: TrackCounts;
    constructor(id: string, counts: TrackCounts);
}
/** The project's tickets per track. */
export declare function countsOf(manifest: ProjectManifest): TrackCounts;
/** The manifest entry of a ticket id, or TicketNotPublishedError. */
export declare function entryById(manifest: ProjectManifest, id: string): TicketEntry;
/** The package files of a ticket out of the files of the whole qa branch. */
export declare function packageOf(entry: TicketEntry, qaFiles: readonly ArchiveFile[]): ArchiveFile[];
/** Checks a ticket package against its manifest entry. */
export declare function verifyPackage(entry: TicketEntry, packageFiles: ArchiveFile[]): ArchiveFile[];
/** Checks a ticket's code against its manifest entry. */
export declare function verifyCode(entry: TicketEntry, codeFiles: ArchiveFile[]): ArchiveFile[];
