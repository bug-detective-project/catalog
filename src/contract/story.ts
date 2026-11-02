/**
 * The story of a project (story.<lang>.json at the root of its qa branch): the client, the project
 * and the manager's messages.
 */
import { z } from 'zod';
import { TICKET_ID } from './manifest.ts';

export const LANGUAGES = ['en', 'pt'] as const;
export type Language = (typeof LANGUAGES)[number];

const text = z.string().min(1);
const message = z.object({ subject: text, body: text });

export const projectStorySchema = z.object({
  client: z.object({
    name: text,
    about: text,
    contacts: text,
    reporters: z.array(z.object({ name: text, role: text })),
  }),
  project: z.object({
    name: text,
    about: text,
    stack: text,
    /** What the player practices in this project (1 to 5, the same count in every language). */
    skills: z.array(z.string().min(1).max(60)).min(1).max(5).optional(),
  }),
  messages: z.object({
    welcome: message,
    /** One message per ticket id (front-1, back-1, …); a ticket without one gets the generic text. */
    assignments: z.record(z.string().regex(TICKET_ID, 'assignments are keyed by ticket id, such as front-1'), message),
    /** The project is done: the first track the player completes. */
    completion: message,
    /** Every later track; {{track}} becomes front, back or fullstack. */
    trackCompletion: message,
  }),
});

export type ProjectStory = z.infer<typeof projectStorySchema>;

export const STORY_FILES = LANGUAGES.map((language) => `story.${language}.json`);

export function parseProjectStory(raw: unknown, file: string): ProjectStory {
  const result = projectStorySchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid ${file}: ${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'unknown error'}`);
  }
  return result.data;
}
