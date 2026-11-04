/**
 * Checks of downloaded or local content against the project manifest. Nothing reaches a player
 * before these pass.
 */
import { assertNoCaseCollisions, treeDigest } from './archive.js';
import { ContentVerificationError, PACKAGE_EXCLUDED } from './manifest.js';
/** The publication is not usable (a ticket commit or tag is missing, or it is older than allowed). */
export class IncompletePublicationError extends ContentVerificationError {
}
/** The published manifest has no ticket with that id (a newer publication with fewer tickets). */
export class TicketNotPublishedError extends ContentVerificationError {
    counts;
    constructor(id, counts) {
        super(`Ticket ${id} is not in the manifest`);
        this.counts = counts;
    }
}
/** The project's tickets per track. */
export function countsOf(manifest) {
    return { front: manifest.tickets.front, back: manifest.tickets.back };
}
/** The manifest entry of a ticket id, or TicketNotPublishedError. */
export function entryById(manifest, id) {
    const entry = manifest.entries.find((item) => item.id === id);
    if (!entry) {
        throw new TicketNotPublishedError(id, countsOf(manifest));
    }
    return entry;
}
/** The package files of a ticket out of the files of the whole qa branch. */
export function packageOf(entry, qaFiles) {
    const prefix = `${entry.package.path}/`;
    return qaFiles
        .filter((file) => file.path.startsWith(prefix) && !PACKAGE_EXCLUDED.has(file.path.slice(prefix.length)))
        .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
}
/** Checks a ticket package against its manifest entry. */
export function verifyPackage(entry, packageFiles) {
    assertNoCaseCollisions(packageFiles);
    if (packageFiles.length !== entry.package.files || treeDigest(packageFiles) !== entry.package.digest) {
        throw new ContentVerificationError(`Ticket ${entry.id}: the package does not match the manifest`);
    }
    return packageFiles;
}
/** Checks a ticket's code against its manifest entry. */
export function verifyCode(entry, codeFiles) {
    assertNoCaseCollisions(codeFiles);
    if (codeFiles.length !== entry.codeFiles || treeDigest(codeFiles) !== entry.codeDigest) {
        throw new ContentVerificationError(`Ticket ${entry.id}: the ticket code does not match the manifest`);
    }
    return codeFiles;
}
