/**
 * The services of a project: the database, cache or message broker its code needs, declared in
 * package.json `bugDetective.project.services` on the qa branch and copied by bd into the manifest.
 *
 * The catalog knows each allowed image (its pinned reference, port, user, data paths and readiness
 * command); a project only picks an image, a memory limit, the container's environment and the
 * variables its own code reads. Whoever starts a service fills `{{host}}` and `{{port}}` in those
 * variables: the desktop with the service name on the project's internal network, bd verify with
 * 127.0.0.1 and the published port.
 *
 * This module is pure: it runs nothing. The desktop imports it too.
 */
import { z } from 'zod';
/** What the app must know to run an image without privileges and to tell when it is ready. */
export interface ServiceImage {
    /** The image pinned by digest; this is what gets pulled and run. */
    reference: string;
    /** The port the server listens on inside the container. */
    port: number;
    /** The image's own unprivileged user (uid:gid): the container never runs as root. */
    user: string;
    /** Where the server keeps its data: a named volume or memory is mounted on each, never an anonymous volume. */
    dataPaths: readonly string[];
    /** Paths the server writes to besides its data, kept in memory (the root file system is read-only). */
    tmpfsPaths: readonly string[];
    /** A command that exits 0 inside the container once the server accepts connections. */
    ready: readonly string[];
}
/** The allowed images. A new one enters by pull request, when a project that needs it is designed. */
export declare const SERVICE_IMAGES: Readonly<Record<string, ServiceImage>>;
export declare const SERVICE_MEMORY_DEFAULT = "256m";
export declare const SERVICE_MEMORY_MIN = "64m";
export declare const SERVICE_MEMORY_MAX = "1g";
export declare const WORKSPACE_MEMORY_DEFAULT = "3g";
export declare const WORKSPACE_MEMORY_MIN = "1g";
export declare const WORKSPACE_MEMORY_MAX = "4g";
/** A QA run's own container, which runs while the workspace and the player's services stay up. */
export declare const QA_MEMORY = "2g";
/** The most a project may need at once: workspace, services, QA and the services of QA. */
export declare const PEAK_MEMORY_MAX = "8g";
export declare const SERVICES_MAX = 4;
/** How long a service may take to accept connections. */
export declare const SERVICE_READY_TIMEOUT_MS = 60000;
/** The process limit of a service container. */
export declare const SERVICE_PIDS = 256;
/** The bytes of a docker memory size in the only form the contract takes: a whole number and k, m or g. */
export declare function memoryBytes(value: string): number;
declare const projectServiceSchema: z.ZodObject<{
    image: z.ZodString;
    memory: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    publish: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type ProjectService = z.infer<typeof projectServiceSchema>;
export type ProjectServices = Record<string, ProjectService>;
export declare const projectServicesSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    image: z.ZodString;
    memory: z.ZodOptional<z.ZodString>;
    env: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    publish: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>>;
/** A project may ask for a larger workspace (package.json `bugDetective.project.memory`). */
export declare const projectMemorySchema: z.ZodObject<{
    workspace: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type ProjectMemory = z.infer<typeof projectMemorySchema>;
/** The services and the memory of a project, as its package.json and its manifest carry them. */
export interface ProjectResources {
    services?: ProjectServices;
    memory?: ProjectMemory;
}
/**
 * The most memory the project needs at once, in bytes: the workspace and its services stay up while
 * a QA run has its own container and its own copy of every service.
 */
export declare function peakMemory(project: ProjectResources): number;
/** The problem of a peak above the limit; undefined when it fits or when a size is malformed. */
export declare function peakMemoryProblem(project: ProjectResources): string | undefined;
/**
 * What is wrong with a project's `services` and `memory`, one line per problem as `<field>: <reason>`;
 * empty when the declaration is valid. The peak is checked only on an otherwise valid declaration.
 */
export declare function projectServicesProblems(project: {
    services?: unknown;
    memory?: unknown;
}): string[];
/** The variables the project's code reads, with each service's address filled in. */
export declare function serviceVariables(services: ProjectServices, address: (name: string) => {
    host: string;
    port: number;
}): Record<string, string>;
/** The image entry of a service; the schema guarantees it exists for a parsed declaration. */
export declare function serviceImageOf(service: ProjectService): ServiceImage;
/**
 * The `docker run` arguments of a service before the image: name, labels, limits, hardening and
 * data. No network and no ports: the caller adds its own. With `data: 'tmpfs'` the data lives in
 * memory and leaves nothing behind; otherwise every data path of the image needs a named volume.
 */
export declare function serviceRunArgs(service: ProjectService, options: {
    name: string;
    labels: Record<string, string>;
    data: 'tmpfs' | Record<string, string>;
}): string[];
export {};
