/**
 * The projects catalog: projects.json at the root of the catalog repository's main branch. It only
 * says where each project lives; names, descriptions and versions come from each project's qa branch.
 */
import { z } from 'zod';
import { compareVersions } from './manifest.js';
const VERSION = /^\d+\.\d+\.\d+$/;
/** Every project lives in the organization: the catalog never points outside it (no repojacking, no owner publishing on their own). */
export const PROJECT_OWNER = 'bug-detective-project';
export const catalogProjectSchema = z.object({
    /** Must match project.id in the manifest of the project's qa branch. */
    id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'ids are lowercase, like supportdesk'),
    /** "bug-detective-project/<name>": the project's public repository, always in the organization. */
    repository: z.string().regex(new RegExp(`^${PROJECT_OWNER}/[A-Za-z0-9_.-]{1,100}$`), `use ${PROJECT_OWNER}/<name>`),
    /** The branch or tag the content comes from. */
    qaRef: z.string().min(1).max(100).default('qa'),
    /** The project a new game starts with; exactly one. */
    starter: z.boolean().default(false),
    /** The oldest app version that can play this project. */
    minAppVersion: z.string().regex(VERSION, 'use X.Y.Z').optional(),
    /** Not offered to players who never played it. */
    hidden: z.boolean().optional(),
});
export const catalogSchema = z
    .object({ projects: z.array(catalogProjectSchema).min(1, 'list at least one project') })
    .superRefine((catalog, ctx) => {
    const issue = (message) => ctx.addIssue({ code: 'custom', message, path: ['projects'] });
    const ids = catalog.projects.map((project) => project.id);
    const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
    if (repeated) {
        issue(`the project ${repeated} is listed twice`);
    }
    const starters = catalog.projects.filter((project) => project.starter);
    if (starters.length !== 1) {
        issue(`exactly one project must be the starter (found ${starters.length})`);
    }
    else if (starters[0].hidden) {
        issue(`the starter cannot be hidden (${starters[0].id})`);
    }
});
export class InvalidCatalogError extends Error {
}
export function parseCatalog(raw) {
    const result = catalogSchema.safeParse(raw);
    if (!result.success) {
        const issue = result.error.issues[0];
        throw new InvalidCatalogError(`Invalid projects catalog: ${issue?.path.join('.') || 'file'}: ${issue?.message ?? 'unknown error'}`);
    }
    return result.data;
}
/** The project a new game starts with. */
export function starterProject(catalog) {
    return catalog.projects.find((project) => project.starter);
}
/** Whether an app of this version can play the project. */
export function appSupports(project, appVersion) {
    return project.minAppVersion === undefined || compareVersions(appVersion, project.minAppVersion) >= 0;
}
