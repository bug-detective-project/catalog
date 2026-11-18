import type { ProjectServices } from '../contract/services.ts';
import type { RunningServices } from './services.ts';
export interface WithServicesOptions {
    /** A JSON file shaped like bugDetective.project.services. */
    file: string;
    /** The command and its arguments. */
    command: readonly string[];
    /** Part of the container names and labels. */
    project: string;
}
export interface WithServicesDeps {
    start?: (services: ProjectServices, options: {
        project: string;
    }) => Promise<RunningServices>;
    /** Runs the command and resolves with its exit code. */
    run?: (command: readonly string[], env: Record<string, string | undefined>) => Promise<number>;
    env?: Record<string, string | undefined>;
}
/** Starts the services of the file, runs the command with their variables, and always stops them. */
export declare function runWithServices(options: WithServicesOptions, deps?: WithServicesDeps): Promise<number>;
