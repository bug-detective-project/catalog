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
import { projectServicesSchema, variableNameProblem } from './services.ts';

export const PORTS_MAX = 6;
export const PORT_MIN = 1024;
/** The workspace mirrors each port at port + 10000, so a port stays below 65535 - 10000. */
export const PORT_MAX = 55535;

const PORT_NAME = /^[a-z][a-z0-9-]{0,19}$/;
const MARKER = /\{\{([^}]*)\}\}/g;

const projectPortSchema = z
  .object({
    /** The port the process listens on inside the workspace. */
    port: z.number().int().min(PORT_MIN).max(PORT_MAX),
    /** The Dashboard offers to open it in the browser. */
    open: z.boolean().optional(),
    /** The name the Dashboard shows; the port's own name without it. */
    label: z
      .object({ en: z.string().min(1).max(40), pt: z.string().min(1).max(40) })
      .strict()
      .optional(),
    /** What the project's code reads, with {{port}} filled by whoever runs the project. */
    variables: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .superRefine((port, ctx) => {
    for (const [name, value] of Object.entries(port.variables ?? {})) {
      const issue = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['variables', name] });
      const nameProblem = variableNameProblem(name);
      if (nameProblem) {
        issue(nameProblem);
        continue;
      }
      const unknown = [...value.matchAll(MARKER)].map((match) => match[1] ?? '').filter((marker) => marker !== 'port');
      if (unknown.length > 0) {
        issue(`unknown marker {{${unknown[0]}}} (only {{port}} is filled)`);
      }
    }
  });

export type ProjectPort = z.infer<typeof projectPortSchema>;
export type ProjectPorts = Record<string, ProjectPort>;

export const projectPortsSchema = z.record(z.string(), projectPortSchema).superRefine((ports, ctx) => {
  const names = Object.keys(ports);
  if (names.length > PORTS_MAX) {
    ctx.addIssue({ code: 'custom', message: `at most ${PORTS_MAX} ports` });
  }
  if (!names.includes('client')) {
    ctx.addIssue({ code: 'custom', message: 'declare the client port, the one "Open app in browser" opens' });
  }
  const byPort = new Map<number, string>();
  const owners = new Map<string, string>();
  for (const name of names) {
    if (!PORT_NAME.test(name)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a port name is lower-case letters, digits and -, starting with a letter, up to 20 characters',
        path: [name],
      });
    }
    const port = ports[name]!;
    const other = byPort.get(port.port);
    if (other !== undefined) {
      ctx.addIssue({ code: 'custom', message: `${port.port} is already the port ${other}`, path: [name, 'port'] });
    } else {
      byPort.set(port.port, name);
    }
    for (const variable of Object.keys(port.variables ?? {})) {
      const owner = owners.get(variable);
      if (owner !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `already defined by the port ${owner}`,
          path: [name, 'variables', variable],
        });
      } else {
        owners.set(variable, name);
      }
    }
  }
});

/**
 * What is wrong with a project's `ports`, one line per problem as `<field>: <reason>`; empty when
 * the declaration is valid. A port variable may not repeat a variable of a service.
 */
export function portsProblems(project: { ports?: unknown; services?: unknown }): string[] {
  if (project.ports === undefined) {
    return [];
  }
  const parsed = projectPortsSchema.safeParse(project.ports);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => `${['ports', ...issue.path].join('.')}: ${issue.message}`);
  }
  const services = projectServicesSchema.safeParse(project.services ?? {});
  const serviceOwners = new Map<string, string>();
  for (const [name, service] of Object.entries(services.success ? services.data : {})) {
    for (const variable of Object.keys(service.variables ?? {})) {
      serviceOwners.set(variable, name);
    }
  }
  const problems: string[] = [];
  for (const [name, port] of Object.entries(parsed.data)) {
    for (const variable of Object.keys(port.variables ?? {})) {
      const service = serviceOwners.get(variable);
      if (service !== undefined) {
        problems.push(`ports.${name}.variables.${variable}: already defined by the service ${service}`);
      }
    }
  }
  return problems;
}

/** The variables of the ports, with {{port}} filled by the port chosen for each name. */
export function portVariables(ports: ProjectPorts, chosen: Record<string, number>): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [name, port] of Object.entries(ports)) {
    const value = chosen[name];
    if (value === undefined) {
      throw new Error(`No port was chosen for ${name}`);
    }
    for (const [variable, template] of Object.entries(port.variables ?? {})) {
      variables[variable] = template.replaceAll('{{port}}', String(value));
    }
  }
  return variables;
}
