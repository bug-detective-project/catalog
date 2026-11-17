/**
 * What a ticket declares about itself: tickets/<id>/ticket.json on a project's qa branch, copied by
 * bd into the ticket's manifest entry. The file is optional: a ticket without it is a fix ticket
 * that touches one side and names no skills.
 */
import { z } from 'zod';
import type { ArchiveFile } from './archive.ts';
/** The kind of work a ticket asks for. */
export declare const TICKET_TYPES: readonly ['fix', 'build', 'complete', 'test', 'refactor', 'optimize', 'upgrade', 'investigate'];
export type TicketType = (typeof TICKET_TYPES)[number];
export declare const TICKET_META_FILE = "ticket.json";
/** The skills a ticket trains, shown to the player once the ticket is Done; the same count in every language. */
export declare const ticketSkillsSchema: z.ZodObject<{
    en: z.ZodArray<z.ZodString>;
    pt: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export type TicketSkills = z.infer<typeof ticketSkillsSchema>;
export declare const ticketMetaSchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<{
        build: "build";
        complete: "complete";
        fix: "fix";
        investigate: "investigate";
        optimize: "optimize";
        refactor: "refactor";
        test: "test";
        upgrade: "upgrade";
    }>>;
    bothSides: z.ZodOptional<z.ZodBoolean>;
    skills: z.ZodOptional<z.ZodObject<{
        en: z.ZodArray<z.ZodString>;
        pt: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type TicketMeta = z.infer<typeof ticketMetaSchema>;
export declare function parseTicketMeta(raw: unknown, file: string): TicketMeta;
/** The metadata of a ticket, read from the files of its package (paths relative to tickets/<id>/). */
export declare function ticketMetaOf(packageFiles: readonly ArchiveFile[], id: string): TicketMeta;
