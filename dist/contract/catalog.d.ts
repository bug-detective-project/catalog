/**
 * The projects catalog: projects.json at the root of the catalog repository's main branch. It only
 * says where each project lives; names, descriptions and versions come from each project's qa branch.
 */
import { z } from 'zod';
export declare const catalogProjectSchema: z.ZodObject<{
    id: z.ZodString;
    repository: z.ZodString;
    qaRef: z.ZodDefault<z.ZodString>;
    starter: z.ZodDefault<z.ZodBoolean>;
    minAppVersion: z.ZodOptional<z.ZodString>;
    hidden: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const catalogSchema: z.ZodObject<{
    projects: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        repository: z.ZodString;
        qaRef: z.ZodDefault<z.ZodString>;
        starter: z.ZodDefault<z.ZodBoolean>;
        minAppVersion: z.ZodOptional<z.ZodString>;
        hidden: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type CatalogProject = z.infer<typeof catalogProjectSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export declare class InvalidCatalogError extends Error {
}
export declare function parseCatalog(raw: unknown): Catalog;
/** The project a new game starts with. */
export declare function starterProject(catalog: Catalog): CatalogProject;
/** Whether an app of this version can play the project. */
export declare function appSupports(project: CatalogProject, appVersion: string): boolean;
