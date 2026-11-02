/**
 * The story of a project (story.<lang>.json at the root of its qa branch): the client, the project
 * and the manager's messages.
 */
import { z } from 'zod';
export declare const LANGUAGES: readonly ['en', 'pt'];
export type Language = (typeof LANGUAGES)[number];
export declare const projectStorySchema: z.ZodObject<{
    client: z.ZodObject<{
        name: z.ZodString;
        about: z.ZodString;
        contacts: z.ZodString;
        reporters: z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            role: z.ZodString;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    project: z.ZodObject<{
        name: z.ZodString;
        about: z.ZodString;
        stack: z.ZodString;
    }, z.core.$strip>;
    messages: z.ZodObject<{
        welcome: z.ZodObject<{
            subject: z.ZodString;
            body: z.ZodString;
        }, z.core.$strip>;
        assignments: z.ZodRecord<z.ZodString, z.ZodObject<{
            subject: z.ZodString;
            body: z.ZodString;
        }, z.core.$strip>>;
        completion: z.ZodObject<{
            subject: z.ZodString;
            body: z.ZodString;
        }, z.core.$strip>;
        trackCompletion: z.ZodObject<{
            subject: z.ZodString;
            body: z.ZodString;
        }, z.core.$strip>;
    }, z.core.$strip>;
}, z.core.$strip>;
export type ProjectStory = z.infer<typeof projectStorySchema>;
export declare const STORY_FILES: string[];
export declare function parseProjectStory(raw: unknown, file: string): ProjectStory;
