/** The tickets of a project: folders tickets/<track>-<order>/ on its qa branch. */
import { TICKET_ID, TRACKS } from '../contract/manifest.ts';
import type { Git } from './git.ts';

/** The ticket ids in queue order: every front ticket, then every back ticket. */
export function ticketQueue(folders: readonly string[]): string[] {
  for (const folder of folders) {
    if (!TICKET_ID.test(folder)) {
      throw new Error(`tickets/${folder}: a ticket folder must be named front-<n> or back-<n>`);
    }
  }
  return TRACKS.flatMap((track) => {
    const orders = folders
      .filter((folder) => folder.startsWith(`${track}-`))
      .map((folder) => Number(folder.slice(track.length + 1)))
      .sort((a, b) => a - b);
    orders.forEach((order, index) => {
      if (order !== index + 1) {
        throw new Error(
          `tickets/: the ${track} tickets must be numbered 1, 2, 3, ... without gaps (found ${track}-${order})`,
        );
      }
    });
    return orders.map((order) => `${track}-${order}`);
  });
}

/** The committed files of tickets/ (untracked files never reach the qa branch, so they never count). */
export async function trackedTicketFiles(git: Git): Promise<string[]> {
  const output = await git.text('ls-files', '-z', '--', 'tickets');
  return output.split('\0').filter(Boolean);
}

/** The ticket ids of the committed tickets/ folders, in queue order. */
export async function ticketIdsOf(git: Git): Promise<string[]> {
  return ticketQueue([...new Set((await trackedTicketFiles(git)).map((file) => file.split('/')[1]))]);
}
