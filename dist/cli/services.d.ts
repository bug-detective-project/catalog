import type { ProjectServices } from '../contract/services.ts';
export type Docker = (args: readonly string[]) => Promise<{
    code: number;
    stdout: string;
    stderr: string;
}>;
export declare const dockerCli: Docker;
/** bd verify cannot run a project with services without Docker; the message says so and why. */
export declare class DockerUnavailableError extends Error {
    constructor(reason: string);
}
export declare const VERIFY_ROLE_LABEL = "bugdetective.role=verify-service";
export interface RunningServices {
    /** The variables the project's code reads, pointing at 127.0.0.1 and each published port. */
    env: Record<string, string>;
    /** Removes the containers; safe to call more than once. */
    stop(): Promise<void>;
}
export interface StartServicesOptions {
    /** The project id, part of the container names and labels. */
    project: string;
    docker?: Docker;
    readyTimeoutMs?: number;
    pollMs?: number;
}
/**
 * Starts every service and waits until each accepts connections. On any failure the containers
 * already created are removed before the error is thrown.
 */
export declare function startServices(services: ProjectServices, options: StartServicesOptions): Promise<RunningServices>;
/**
 * Removes the verify containers a crashed bd left behind: those whose owner process no longer
 * exists. A bd verify running at the same time keeps its own. Returns the names removed.
 */
export declare function sweepVerifyServices(options?: {
    docker?: Docker;
    alive?: (pid: number) => boolean;
}): Promise<string[]>;
