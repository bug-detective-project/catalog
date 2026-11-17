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
/** The allowed images. A new one enters by pull request, when a project that needs it is designed. */
export const SERVICE_IMAGES = {
    'postgres:17': {
        reference: 'postgres@sha256:0d938e975177bef9f1f61f3f9dbcf2e0aa0a139568f66d3415ed8892eb97f6ac',
        port: 5432,
        user: '999:999',
        dataPaths: ['/var/lib/postgresql/data'],
        tmpfsPaths: ['/var/run/postgresql', '/tmp'],
        ready: ['pg_isready', '-q', '-h', '127.0.0.1'],
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
const UNITS = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
/** The bytes of a docker memory size in the only form the contract takes: a whole number and k, m or g. */
export function memoryBytes(value) {
    const match = MEMORY.exec(value);
    if (!match) {
        throw new Error(`${JSON.stringify(value)} is not a memory size (a whole number followed by k, m or g, like 256m)`);
    }
    return Number(match[1]) * UNITS[match[2]];
}
/** A memory size between two bounds, both included. */
function memoryBetween(min, max) {
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
})
    .strict()
    .superRefine((service, ctx) => {
    for (const [name, value] of Object.entries(service.variables ?? {})) {
        const issue = (message) => ctx.addIssue({ code: 'custom', message, path: ['variables', name] });
        if (!VARIABLE_NAME.test(name)) {
            issue('a variable name is upper-case letters, digits and _, starting with a letter');
        }
        else if (name.startsWith(APP_PREFIX)) {
            issue(`names starting with ${APP_PREFIX} belong to the app`);
        }
        else if (RESERVED_VARIABLES.includes(name)) {
            issue(`${name} is reserved (${RESERVED_VARIABLES.join(', ')})`);
        }
        else {
            const unknown = [...value.matchAll(MARKER)].map((match) => match[1] ?? '').filter((m) => !MARKERS.includes(m));
            if (unknown.length > 0) {
                issue(`unknown marker {{${unknown[0]}}} (only {{host}} and {{port}} are filled)`);
            }
        }
    }
});
export const projectServicesSchema = z.record(z.string(), projectServiceSchema).superRefine((services, ctx) => {
    const names = Object.keys(services);
    if (names.length > SERVICES_MAX) {
        ctx.addIssue({ code: 'custom', message: `at most ${SERVICES_MAX} services` });
    }
    const owners = new Map();
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
            }
            else {
                owners.set(variable, name);
            }
        }
    }
});
/** A project may ask for a larger workspace (package.json `bugDetective.project.memory`). */
export const projectMemorySchema = z
    .object({ workspace: memoryBetween(WORKSPACE_MEMORY_MIN, WORKSPACE_MEMORY_MAX).optional() })
    .strict();
/**
 * The most memory the project needs at once, in bytes: the workspace and its services stay up while
 * a QA run has its own container and its own copy of every service.
 */
export function peakMemory(project) {
    const services = Object.values(project.services ?? {}).reduce((sum, service) => sum + memoryBytes(service.memory ?? SERVICE_MEMORY_DEFAULT), 0);
    return memoryBytes(project.memory?.workspace ?? WORKSPACE_MEMORY_DEFAULT) + memoryBytes(QA_MEMORY) + 2 * services;
}
const gigabytes = (bytes) => `${Number((bytes / UNITS.g).toFixed(2))} GB`;
/** The problem of a peak above the limit; undefined when it fits or when a size is malformed. */
export function peakMemoryProblem(project) {
    let peak;
    try {
        peak = peakMemory(project);
    }
    catch {
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
export function projectServicesProblems(project) {
    const problems = [];
    const check = (field, schema, value) => {
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
        const peak = peakMemoryProblem(project);
        if (peak) {
            problems.push(`memory: ${peak}`);
        }
    }
    return problems;
}
/** The variables the project's code reads, with each service's address filled in. */
export function serviceVariables(services, address) {
    const variables = {};
    for (const [name, service] of Object.entries(services)) {
        const { host, port } = address(name);
        for (const [variable, value] of Object.entries(service.variables ?? {})) {
            variables[variable] = value.replaceAll('{{host}}', host).replaceAll('{{port}}', String(port));
        }
    }
    return variables;
}
/** The image entry of a service; the schema guarantees it exists for a parsed declaration. */
export function serviceImageOf(service) {
    const image = SERVICE_IMAGES[service.image];
    if (!image) {
        throw new Error(`${service.image} is not an allowed image`);
    }
    return image;
}
/**
 * The `docker run` arguments of a service before the image: name, labels, limits, hardening and
 * data. No network and no ports: the caller adds its own. With `data: 'tmpfs'` the data lives in
 * memory and leaves nothing behind; otherwise every data path of the image needs a named volume.
 */
export function serviceRunArgs(service, options) {
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
