/**
 * The project files of a qa branch besides its tickets: the QA tool (the CLI the QA image runs),
 * the review configuration (review.json) and the project's story (story.<lang>.json).
 */
import { z } from 'zod';
import { fileText } from './archive.js';
import { parseReviewConfig } from './review.js';
import { LANGUAGES, STORY_FILES, parseProjectStory } from './story.js';
/** The files of the qa branch that are not the QA tool. */
function notTool(path) {
    return (path.startsWith('tickets/') || path === 'manifest.json' || path === 'review.json' || STORY_FILES.includes(path));
}
/** The QA tool: the qa branch without the tickets, the manifest, the review configuration and the story. */
export function qaToolFiles(qaFiles) {
    return qaFiles.filter((file) => !notTool(file.path));
}
function json(file) {
    try {
        return JSON.parse(fileText(file));
    }
    catch {
        throw new Error(`${file.path} is not valid JSON`);
    }
}
/** The review configuration and the story of a project, from the files of its qa branch. */
export function projectContentOf(qaFiles) {
    const byPath = new Map(qaFiles.map((file) => [file.path, file]));
    const reviewFile = byPath.get('review.json');
    const story = Object.fromEntries(LANGUAGES.map((language) => {
        const name = `story.${language}.json`;
        const file = byPath.get(name);
        if (!file) {
            throw new Error(`The qa branch has no ${name}`);
        }
        return [language, parseProjectStory(json(file), name)];
    }));
    const skills = (language) => story[language].project.skills?.length ?? 0;
    for (const language of LANGUAGES) {
        if (skills(language) !== skills(LANGUAGES[0])) {
            throw new Error(`story.${language}.json: project.skills has ${skills(language)} item(s), story.${LANGUAGES[0]}.json has ${skills(LANGUAGES[0])}: every language needs the same skills`);
        }
    }
    return { review: reviewOf(reviewFile ? json(reviewFile) : undefined), story };
}
function reviewOf(raw) {
    try {
        return parseReviewConfig(raw);
    }
    catch (error) {
        const issue = error instanceof z.ZodError ? error.issues[0] : undefined;
        throw new Error(`Invalid review.json: ${issue ? `${issue.path.join('.')}: ${issue.message}` : error.message}`, { cause: error });
    }
}
