/**
 * The services of a project: the database, cache or message broker its code needs, declared in
 * package.json `bugDetective.project.services` on the qa branch and copied by bd into the manifest.
 *
 * The catalog knows each allowed image (its pinned reference, port, user, data paths, readiness
 * command and server program); a project only picks an image, a memory limit, the container's
 * environment, the arguments of the server and the variables its own code reads. Whoever starts a service fills `{{host}}` and `{{port}}` in those
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
  /**
   * The first app version whose contract knows this image: an older app refuses the whole manifest
   * of a project that uses it, so the catalog asks at least this `minAppVersion` of such a project.
   */
  minAppVersion: string;
  /** The server program: what runs, followed by the project's `args`, when a service declares any. */
  server: string;
  /**
   * The options the app sets itself (port, data folder, listening address, user). A project that
   * passes one is told so when it is validated, instead of getting a service that never is ready.
   * This is for a clear message, not a security boundary: that is the container's hardening.
   */
  reservedOptions: readonly string[];
}

/** The allowed images. A new one enters by pull request, when a project that needs it is designed. */
export const SERVICE_IMAGES: Readonly<Record<string, ServiceImage>> = {
  'postgres:17': {
    reference: 'postgres@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac',
    port: 5432,
    user: '999:999',
    dataPaths: ['/var/lib/postgresql/data'],
    tmpfsPaths: ['/var/run/postgresql', '/tmp'],
    ready: ['pg_isready', '-q', '-h', '127.0.0.1'],
    minAppVersion: '1.2.0',
    server: 'postgres',
    reservedOptions: [
      '-p',
      '--port',
      '-D',
      '--data-directory',
      '-h',
      '--listen-addresses',
      '-k',
      '--unix-socket-directories',
      '--config-file',
      '--hba-file',
    ],
  },
  // MySQL 8.4 LTS. Its default server needs 512m: at 256m it is killed while it creates its data.
  // Ready asks over TCP, because while it creates the data the image runs a server without a network.
  'mysql:8.4': {
    reference: 'mysql@sha256:a81d043930e51745522bd5c430961cf8286f0a23f0a9a2a6e0108f7ea71b0902',
    port: 3306,
    user: '999:999',
    dataPaths: ['/var/lib/mysql'],
    tmpfsPaths: ['/var/run/mysqld', '/var/lib/mysql-files', '/tmp'],
    ready: ['mysqladmin', 'ping', '--silent', '-h', '127.0.0.1'],
    minAppVersion: '1.3.0',
    server: 'mysqld',
    reservedOptions: [
      '-P',
      '--port',
      '-h',
      '--datadir',
      '--bind-address',
      '-u',
      '--user',
      '-S',
      '--socket',
      '--skip-networking',
    ],
  },
  // Redis 8 (8.10.3). The image reads no password from the environment: a project gives it, and a
  // memory limit, as `args`. Ready needs no password: an answer of NOAUTH still exits 0.
  'redis:8': {
    reference: 'redis@sha256:91cc9227bca4d2f717b1ad33d2ebba8127c16b0c2ca731dd9e6010d7629227a5',
    port: 6379,
    user: '999:999',
    dataPaths: ['/data'],
    tmpfsPaths: [],
    ready: ['redis-cli', '-h', '127.0.0.1', 'ping'],
    minAppVersion: '1.4.0',
    server: 'redis-server',
    reservedOptions: ['--port', '--bind', '--dir', '--unixsocket', '--tls-port', '--daemonize'],
  },
};

export const SERVICE_MEMORY_DEFAULT = '256m';
export const SERVICE_MEMORY_MIN = '64m';
export const SERVICE_MEMORY_MAX = '1g';
export const WORKSPACE_MEMORY_DEFAULT = '3g';
export const WORKSPACE_MEMORY_MIN = '1g';
export const WORKSPACE_MEMORY_MAX = '4g';
/** A QA run's own container, which runs while the workspace and the player's services stay up. */
export const QA_MEMORY = '2g';
/** The most a project may need at once: workspace, services, QA and the services of QA. */
export const PEAK_MEMORY_MAX = '8g';
export const SERVICES_MAX = 4;
/** The most arguments a service may declare, and the longest one. */
export const SERVICE_ARGS_MAX = 24;
export const SERVICE_ARG_LENGTH_MAX = 200;
/** How long a service may take to accept connections. */
export const SERVICE_READY_TIMEOUT_MS = 60_000;
/** The process limit of a service container. */
export const SERVICE_PIDS = 256;

const SERVICE_NAME = /^[a-z][a-z0-9-]{0,19}$/;
const VARIABLE_NAME = /^[A-Z][A-Z0-9_]*$/;
const MEMORY = /^([1-9]\d*)([kmg])$/;
const MARKER = /\{\{([^}]*)\}\}/g;
const MARKERS = ['host', 'port'];
/** Names a project may not set: the app's own prefix and what the workspace's shell and Node depend on. */
const APP_PREFIX = 'BUGDETECTIVE_';
const RESERVED_VARIABLES = ['PATH', 'HOME', 'NODE_OPTIONS', 'NODE_PATH', 'SHELL', 'USER', 'PWD'];

const UNITS = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 } as const;
/** A line break or another control character: nothing a server option needs. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * The reserved option each argument sets, by position: an option of the image's `reservedOptions`
 * in any of its spellings. A long option is compared up to its `=`, with `_` read as `-`
 * (`--data_directory=/x`); a short one also with its value attached (`-P3307`), in its own case;
 * and PostgreSQL's `-c name=value` (or `-cname=value`) counts as the long option `--name`.
 */
function reservedOptionsIn(image: ServiceImage, args: readonly string[]): Map<number, string> {
  const found = new Map<number, string>();
  const long = (text: string): string | undefined => {
    const option = text.split('=')[0]!.replaceAll('_', '-');
    return image.reservedOptions.includes(option) ? option : undefined;
  };
  args.forEach((arg, index) => {
    let option: string | undefined;
    if (image.server === 'postgres' && arg.startsWith('-c') && !arg.startsWith('--')) {
      // The setting follows -c, attached or as the next argument, which is reported in its own turn.
      option = arg.length > 2 ? long(`--${arg.slice(2)}`) : undefined;
    } else if (image.server === 'postgres' && args[index - 1] === '-c') {
      option = long(`--${arg}`);
    } else if (arg.startsWith('--')) {
      option = long(arg);
    } else if (arg.startsWith('-')) {
      option = image.reservedOptions.find((reserved) => !reserved.startsWith('--') && arg.startsWith(reserved));
    }
    if (option !== undefined) {
      found.set(index, option);
    }
  });
  return found;
}

/**
 * What is wrong with the name of a variable a project declares for its code (a service's or a
 * port's); undefined when it is fine.
 */
export function variableNameProblem(name: string): string | undefined {
  if (!VARIABLE_NAME.test(name)) {
    return 'a variable name is upper-case letters, digits and _, starting with a letter';
  }
  if (name.startsWith(APP_PREFIX)) {
    return `names starting with ${APP_PREFIX} belong to the app`;
  }
  if (RESERVED_VARIABLES.includes(name)) {
    return `${name} is reserved (${RESERVED_VARIABLES.join(', ')})`;
  }
  return undefined;
}

/** The bytes of a docker memory size in the only form the contract takes: a whole number and k, m or g. */
export function memoryBytes(value: string): number {
  const match = MEMORY.exec(value);
  if (!match) {
    throw new Error(`${JSON.stringify(value)} is not a memory size (a whole number followed by k, m or g, like 256m)`);
  }
  return Number(match[1]) * UNITS[match[2] as keyof typeof UNITS];
}

/** A memory size between two bounds, both included. */
function memoryBetween(min: string, max: string) {
  return z.string().superRefine((value, ctx) => {
    if (!MEMORY.test(value)) {
      ctx.addIssue({ code: 'custom', message: 'must be a whole number followed by k, m or g, like 256m' });
      return;
    }
    const bytes = memoryBytes(value);
    if (bytes < memoryBytes(min) || bytes > memoryBytes(max)) {
      ctx.addIssue({ code: 'custom', message: `must be between ${min} and ${max}` });
    }
  });
}

const projectServiceSchema = z
  .object({
    image: z.string().refine((image) => Object.hasOwn(SERVICE_IMAGES, image), {
      message: `is not an allowed image (allowed: ${Object.keys(SERVICE_IMAGES).join(', ')}; change the list in the catalog repository)`,
    }),
    memory: memoryBetween(SERVICE_MEMORY_MIN, SERVICE_MEMORY_MAX).optional(),
    /** The environment of the service's own container (its user, password, database name). */
    env: z.record(z.string(), z.string()).optional(),
    /** What the project's code reads, with {{host}} and {{port}} filled by whoever starts the service. */
    variables: z.record(z.string(), z.string()).optional(),
    /**
     * The app also publishes the service's port on the player's computer, on 127.0.0.1 only and
     * on a free port, for the player's own database tools. The code never uses it.
     */
    publish: z.boolean().optional(),
    /**
     * The arguments of the server (a password, a memory limit, a setting): they follow the image's
     * server program, which the project does not choose. Without them the image runs as it is.
     */
    args: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((service, ctx) => {
    const args = service.args ?? [];
    const argIssue = (message: string, index?: number) =>
      ctx.addIssue({ code: 'custom', message, path: index === undefined ? ['args'] : ['args', index] });
    if (args.length > SERVICE_ARGS_MAX) {
      argIssue(`at most ${SERVICE_ARGS_MAX} arguments`);
    }
    if (args[0] !== undefined && !args[0].startsWith('-')) {
      argIssue('the first argument must be an option (start with -)', 0);
    }
    args.forEach((arg, index) => {
      // An empty argument is a value some servers take: Redis turns its snapshots off with --save "".
      if (arg.length > SERVICE_ARG_LENGTH_MAX) {
        argIssue(`at most ${SERVICE_ARG_LENGTH_MAX} characters`, index);
      } else if (CONTROL_CHARACTER.test(arg)) {
        argIssue('an argument may not have line breaks or other control characters', index);
      }
    });
    const image = SERVICE_IMAGES[service.image];
    for (const [index, option] of image ? reservedOptionsIn(image, args) : []) {
      argIssue(`${option} is set by the app`, index);
    }
    for (const [name, value] of Object.entries(service.variables ?? {})) {
      const issue = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['variables', name] });
      const nameProblem = variableNameProblem(name);
      if (nameProblem) {
        issue(nameProblem);
      } else {
        const unknown = [...value.matchAll(MARKER)].map((match) => match[1] ?? '').filter((m) => !MARKERS.includes(m));
        if (unknown.length > 0) {
          issue(`unknown marker {{${unknown[0]}}} (only {{host}} and {{port}} are filled)`);
        }
      }
    }
  });

export type ProjectService = z.infer<typeof projectServiceSchema>;
export type ProjectServices = Record<string, ProjectService>;

export const projectServicesSchema = z.record(z.string(), projectServiceSchema).superRefine((services, ctx) => {
  const names = Object.keys(services);
  if (names.length > SERVICES_MAX) {
    ctx.addIssue({ code: 'custom', message: `at most ${SERVICES_MAX} services` });
  }
  const owners = new Map<string, string>();
  for (const name of names) {
    if (!SERVICE_NAME.test(name)) {
      ctx.addIssue({
        code: 'custom',
        message: 'a service name is lower-case letters, digits and -, starting with a letter, up to 20 characters',
        path: [name],
      });
    }
    for (const variable of Object.keys(services[name]?.variables ?? {})) {
      const owner = owners.get(variable);
      if (owner !== undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `already defined by the service ${owner}`,
          path: [name, 'variables', variable],
        });
      } else {
        owners.set(variable, name);
      }
    }
  }
});

/** A project may ask for a larger workspace (package.json `bugDetective.project.memory`). */
export const projectMemorySchema = z
  .object({ workspace: memoryBetween(WORKSPACE_MEMORY_MIN, WORKSPACE_MEMORY_MAX).optional() })
  .strict();
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
export function peakMemory(project: ProjectResources): number {
  const services = Object.values(project.services ?? {}).reduce(
    (sum, service) => sum + memoryBytes(service.memory ?? SERVICE_MEMORY_DEFAULT),
    0,
  );
  return memoryBytes(project.memory?.workspace ?? WORKSPACE_MEMORY_DEFAULT) + memoryBytes(QA_MEMORY) + 2 * services;
}

const gigabytes = (bytes: number): string => `${Number((bytes / UNITS.g).toFixed(2))} GB`;

/** The problem of a peak above the limit; undefined when it fits or when a size is malformed. */
export function peakMemoryProblem(project: ProjectResources): string | undefined {
  let peak: number;
  try {
    peak = peakMemory(project);
  } catch {
    // A malformed size is reported on its own field; there is no peak to add up.
    return undefined;
  }
  const limit = memoryBytes(PEAK_MEMORY_MAX);
  return peak > limit
    ? `the peak is ${gigabytes(peak)} (workspace, services, QA and its services at the same time) and the limit is ${gigabytes(limit)}`
    : undefined;
}

/**
 * What is wrong with a project's `services` and `memory`, one line per problem as `<field>: <reason>`;
 * empty when the declaration is valid. The peak is checked only on an otherwise valid declaration.
 */
export function projectServicesProblems(project: { services?: unknown; memory?: unknown }): string[] {
  const problems: string[] = [];
  const check = (field: string, schema: z.ZodType, value: unknown): void => {
    if (value === undefined) {
      return;
    }
    const parsed = schema.safeParse(value);
    for (const issue of parsed.success ? [] : parsed.error.issues) {
      problems.push(`${[field, ...issue.path].join('.')}: ${issue.message}`);
    }
  };
  check('services', projectServicesSchema, project.services);
  check('memory', projectMemorySchema, project.memory);
  if (problems.length === 0) {
    const peak = peakMemoryProblem(project as ProjectResources);
    if (peak) {
      problems.push(`memory: ${peak}`);
    }
  }
  return problems;
}

/** The variables the project's code reads, with each service's address filled in. */
export function serviceVariables(
  services: ProjectServices,
  address: (name: string) => { host: string; port: number },
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [name, service] of Object.entries(services)) {
    const { host, port } = address(name);
    for (const [variable, value] of Object.entries(service.variables ?? {})) {
      variables[variable] = value.replaceAll('{{host}}', host).replaceAll('{{port}}', String(port));
    }
  }
  return variables;
}

/** The image entry of a service; the schema guarantees it exists for a parsed declaration. */
export function serviceImageOf(service: ProjectService): ServiceImage {
  const image = SERVICE_IMAGES[service.image];
  if (!image) {
    throw new Error(`${service.image} is not an allowed image`);
  }
  return image;
}

/**
 * What follows the image in the `docker run` of a service: nothing when it declares no arguments
 * (the image runs its own command, as always), otherwise the image's server program and the
 * arguments, each as it was declared. Nothing here goes through a shell.
 */
export function serviceCommand(service: ProjectService): string[] {
  const args = service.args ?? [];
  return args.length === 0 ? [] : [serviceImageOf(service).server, ...args];
}

/**
 * The `docker run` arguments of a service before the image: name, labels, limits, hardening and
 * data. No network and no ports: the caller adds its own. With `data: 'tmpfs'` the data lives in
 * memory and leaves nothing behind; otherwise every data path of the image needs a named volume.
 */
export function serviceRunArgs(
  service: ProjectService,
  options: { name: string; labels: Record<string, string>; data: 'tmpfs' | Record<string, string> },
): string[] {
  const image = serviceImageOf(service);
  const [uid, gid] = image.user.split(':');
  const args = [
    '--name',
    options.name,
    '--restart',
    'no',
    '--memory',
    service.memory ?? SERVICE_MEMORY_DEFAULT,
    '--pids-limit',
    String(SERVICE_PIDS),
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    image.user,
    '--read-only',
  ];
  for (const [label, value] of Object.entries(options.labels)) {
    args.push('--label', `${label}=${value}`);
  }
  for (const path of image.tmpfsPaths) {
    args.push('--tmpfs', path);
  }
  for (const path of image.dataPaths) {
    if (options.data === 'tmpfs') {
      args.push('--tmpfs', `${path}:uid=${uid},gid=${gid},mode=0700`);
      continue;
    }
    const volume = options.data[path];
    if (!volume) {
      throw new Error(`No volume for the data path ${path} of ${service.image}`);
    }
    args.push('--mount', `type=volume,src=${volume},dst=${path}`);
  }
  for (const [variable, value] of Object.entries(service.env ?? {})) {
    args.push('--env', `${variable}=${value}`);
  }
  return args;
}
