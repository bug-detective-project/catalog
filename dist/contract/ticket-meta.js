/**
 * What a ticket declares about itself: tickets/<id>/ticket.json on a project's qa branch, copied by
 * bd into the ticket's manifest entry. The file is optional: a ticket without it is a fix ticket
 * that touches one side and names no skills.
 */
import { z } from 'zod';
/** The kind of work a ticket asks for. */
export const TICKET_TYPES = [
    'fix',
    'build',
    'complete',
    'test',
    'refactor',
    'optimize',
    'upgrade',
    'investigate',
];
export const TICKET_META_FILE = 'ticket.json';
/** The skills of one language: free text, written with the words of the Bug Detective documentation. */
const skillList = z
    .array(z.string().min(1).max(60))
    .min(1)
    .max(5)
    .refine((items) => new Set(items).size === items.length, 'a skill is listed twice');
/** The skills a ticket trains, shown to the player once the ticket is Done; the same count in every language. */
export const ticketSkillsSchema = z
    .object({ en: skillList, pt: skillList })
    .strict()
    .refine((skills) => skills.en.length === skills.pt.length, 'en and pt must list the same number of skills');
export const ticketMetaSchema = z
    .object({
    type: z.enum(TICKET_TYPES),
    /** The ticket needs changes in the front end and in the back end; it still belongs to one track. */
    bothSides: z.boolean(),
    skills: ticketSkillsSchema,
})
    .partial()
    .strict();
export function parseTicketMeta(raw, file) {
    const result = ticketMetaSchema.safeParse(raw);
    if (!result.success) {
        const issue = result.error.issues[0];
        throw new Error(`Invalid ${file}: ${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'unknown error'}`);
    }
    return result.data;
}
/** The metadata of a ticket, read from the files of its package (paths relative to tickets/<id>/). */
export function ticketMetaOf(packageFiles, id) {
    const file = packageFiles.find((item) => item.path === TICKET_META_FILE);
    if (!file) {
        return {};
    }
    const name = `tickets/${id}/${TICKET_META_FILE}`;
    let raw;
    try {
        raw = JSON.parse(new TextDecoder().decode(file.data));
    }
    catch {
        throw new Error(`Invalid ${name}: not valid JSON`);
    }
    return parseTicketMeta(raw, name);
}
