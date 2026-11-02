import type { Git } from './git.ts';
/** The ticket ids in queue order: every front ticket, then every back ticket. */
export declare function ticketQueue(folders: readonly string[]): string[];
/** The committed files of tickets/ (untracked files never reach the qa branch, so they never count). */
export declare function trackedTicketFiles(git: Git): Promise<string[]>;
/** The ticket ids of the committed tickets/ folders, in queue order. */
export declare function ticketIdsOf(git: Git): Promise<string[]>;
