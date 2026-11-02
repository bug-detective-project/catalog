/**
 * The project manifest: manifest.json at the root of a project's qa branch, written by bd publish
 * and checked by the bd CLI and by every content source of the desktop app.
 */
import { z } from 'zod';
export declare const TRACKS: readonly ['front', 'back'];
export type Track = (typeof TRACKS)[number];
/** A ticket id: its track and its order in the track, also the name of its branch and folder. */
export declare const TICKET_ID: RegExp;
/** The newest content format this code understands; a newer one needs a newer app. */
export declare const SUPPORTED_FORMAT_VERSION = 1;
export declare const ticketEntrySchema: z.ZodObject<{
    id: z.ZodString;
    track: z.ZodEnum<{
        back: "back";
        front: "front";
    }>;
    order: z.ZodNumber;
    branch: z.ZodString;
    tag: z.ZodString;
    commit: z.ZodString;
    commitMessage: z.ZodString;
    codeDigest: z.ZodString;
    codeFiles: z.ZodNumber;
    package: z.ZodObject<{
        path: z.ZodString;
        files: z.ZodNumber;
        digest: z.ZodString;
    }, z.core.$strip>;
}, z.core.$strip>;
/** The project's technologies (package.json bugDetective.project.stack), shown in the project brief. */
export declare const projectStackSchema: z.ZodObject<{
    frontend: z.ZodOptional<z.ZodString>;
    backend: z.ZodOptional<z.ZodString>;
    database: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const manifestSchema: z.ZodObject<{
    format: z.ZodLiteral<"bug-detective-project">;
    formatVersion: z.ZodNumber;
    project: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        difficulty: z.ZodOptional<z.ZodEnum<{
            advanced: "advanced";
            beginner: "beginner";
            intermediate: "intermediate";
        }>>;
        stack: z.ZodOptional<z.ZodObject<{
            frontend: z.ZodOptional<z.ZodString>;
            backend: z.ZodOptional<z.ZodString>;
            database: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strip>;
    version: z.ZodString;
    createdAt: z.ZodString;
    tickets: z.ZodObject<{
        total: z.ZodNumber;
        front: z.ZodNumber;
        back: z.ZodNumber;
    }, z.core.$strip>;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        track: z.ZodEnum<{
            back: "back";
            front: "front";
        }>;
        order: z.ZodNumber;
        branch: z.ZodString;
        tag: z.ZodString;
        commit: z.ZodString;
        commitMessage: z.ZodString;
        codeDigest: z.ZodString;
        codeFiles: z.ZodNumber;
        package: z.ZodObject<{
            path: z.ZodString;
            files: z.ZodNumber;
            digest: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type TicketEntry = z.infer<typeof ticketEntrySchema>;
export type ProjectManifest = z.infer<typeof manifestSchema>;
export declare class ContentVerificationError extends Error {
}
/** The manifest uses a content format newer than SUPPORTED_FORMAT_VERSION. */
export declare class UnsupportedFormatError extends ContentVerificationError {
    readonly formatVersion: number;
    constructor(formatVersion: number);
}
/** Validates a manifest; with expectedProject, also that it belongs to that project. */
export declare function parseManifest(json: unknown, expectedProject?: string): ProjectManifest;
/** Compares two X.Y.Z versions: negative, zero or positive. */
export declare function compareVersions(a: string, b: string): number;
/** Files of the authoring folder that never go into a player's ticket package. */
export declare const PACKAGE_EXCLUDED: Set<string>;
