/**
 * The ports of a project: the ones its processes listen on inside the workspace, which the desktop
 * publishes on the player's computer (127.0.0.1, on a free port each), declared in package.json
 * `bugDetective.project.ports` on the qa branch and copied by bd into the manifest. A project
 * without `ports` gets the app's two ports: the client (5173) and the API (3001).
 *
 * Each port may give its code variables with {{port}}, filled with the port chosen on the
 * computer (by the desktop) or in the run (by a project's QA CLI), through portVariables.
 *
 * This module is pure: it runs nothing. The desktop imports it too.
 */
import { z } from 'zod';
export declare const PORTS_MAX = 6;
export declare const PORT_MIN = 1024;
/** The workspace mirrors each port at port + 10000, so a port stays below 65535 - 10000. */
export declare const PORT_MAX = 55535;
declare const projectPortSchema: z.ZodObject<{
    port: z.ZodNumber;
    open: z.ZodOptional<z.ZodBoolean>;
    label: z.ZodOptional<z.ZodObject<{
        en: z.ZodString;
        pt: z.ZodString;
    }, z.core.$strict>>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>;
export type ProjectPort = z.infer<typeof projectPortSchema>;
export type ProjectPorts = Record<string, ProjectPort>;
export declare const projectPortsSchema: z.ZodRecord<z.ZodString, z.ZodObject<{
    port: z.ZodNumber;
    open: z.ZodOptional<z.ZodBoolean>;
    label: z.ZodOptional<z.ZodObject<{
        en: z.ZodString;
        pt: z.ZodString;
    }, z.core.$strict>>;
    variables: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strict>>;
/**
 * What is wrong with a project's `ports`, one line per problem as `<field>: <reason>`; empty when
 * the declaration is valid. A port variable may not repeat a variable of a service.
 */
export declare function portsProblems(project: {
    ports?: unknown;
    services?: unknown;
}): string[];
/** The variables of the ports, with {{port}} filled by the port chosen for each name. */
export declare function portVariables(ports: ProjectPorts, chosen: Record<string, number>): Record<string, string>;
export {};
