import type { ArchiveFile } from './archive.ts';
import type { ReviewConfig } from './review.ts';
import type { Language, ProjectStory } from './story.ts';
/** The QA tool: the qa branch without the tickets, the manifest, the review configuration and the story. */
export declare function qaToolFiles(qaFiles: readonly ArchiveFile[]): ArchiveFile[];
export interface ProjectFiles {
    review: ReviewConfig;
    story: Record<Language, ProjectStory>;
}
/** The review configuration and the story of a project, from the files of its qa branch. */
export declare function projectContentOf(qaFiles: readonly ArchiveFile[]): ProjectFiles;
