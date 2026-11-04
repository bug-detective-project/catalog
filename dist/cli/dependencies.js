/**
 * The dependency checks of bd validate (see ../contract/dependencies.ts for the rules): the
 * lockfile's origins and integrity, the install scripts a project allows, the .npmrc, and the age
 * of every version on the registry.
 */
import { ALLOWED_INSTALL_SCRIPTS, MIN_RELEASE_AGE_DAYS, NPM_REGISTRY, REQUIRED_NPMRC, } from '../contract/dependencies.js';
/** The name of a package from its lockfile path (`node_modules/@scope/name` → `@scope/name`). */
export function packageName(path) {
    const index = path.lastIndexOf('node_modules/');
    return index === -1 ? path : path.slice(index + 'node_modules/'.length);
}
/** The installed packages of a lockfile: the root and workspace links left out. */
export function installedPackages(lock) {
    return Object.entries(lock.packages ?? {}).filter(([path, pkg]) => path !== '' && !pkg.link && path.includes('node_modules/'));
}
/** Origins and integrity: every package from the public registry, with its integrity hash. */
export function lockfileOriginProblems(lock) {
    const problems = [];
    for (const [path, pkg] of installedPackages(lock)) {
        if (!pkg.resolved?.startsWith(NPM_REGISTRY)) {
            problems.push(`${packageName(path)} comes from ${pkg.resolved ?? 'nowhere'}: every dependency must come from ${NPM_REGISTRY}`);
        }
        if (!pkg.integrity) {
            problems.push(`${packageName(path)} has no integrity hash in the lockfile`);
        }
    }
    return problems;
}
/**
 * Install scripts: a package with one runs only when package.json allows it (npm's allowScripts),
 * and a project may only allow the packages of ALLOWED_INSTALL_SCRIPTS.
 */
export function installScriptProblems(lock, packageJson) {
    const problems = [];
    const allowed = Object.entries(packageJson.allowScripts ?? {})
        .filter(([, on]) => on)
        .map(([spec]) => spec);
    for (const spec of allowed) {
        const name = spec.startsWith('@') ? `@${spec.slice(1).split('@')[0]}` : spec.split('@')[0];
        if (!ALLOWED_INSTALL_SCRIPTS.includes(name)) {
            problems.push(`package.json allows the install scripts of ${spec}, which is not in the catalog's list (${ALLOWED_INSTALL_SCRIPTS.join(', ')}): change the list in the catalog repository`);
        }
        const path = Object.keys(lock.packages ?? {}).find((item) => packageName(item) === name);
        if (path && !lock.packages?.[path]?.hasInstallScript) {
            problems.push(`package.json allows the install scripts of ${spec}, but the lockfile says it has none`);
        }
    }
    return problems;
}
/** The .npmrc of a project with dependencies: present, with the required keys and values. */
export function npmrcProblems(text) {
    if (text === undefined) {
        return [
            `.npmrc is missing: it must set ${Object.entries(REQUIRED_NPMRC)
                .map(([key, value]) => `${key}=${value}`)
                .join(', ')}`,
        ];
    }
    const values = new Map();
    for (const line of text.split('\n')) {
        const match = /^\s*([^#;=\s]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (match) {
            values.set(match[1], match[2]);
        }
    }
    const problems = [];
    for (const [key, value] of Object.entries(REQUIRED_NPMRC)) {
        if (values.get(key) !== value) {
            problems.push(`.npmrc must set ${key}=${value} (found ${values.has(key) ? `${key}=${values.get(key)}` : 'nothing'})`);
        }
    }
    return problems;
}
/** Versions published less than MIN_RELEASE_AGE_DAYS ago (typosquats and hijacked versions are usually caught within days). */
export async function releaseAgeProblems(lock, fetchJson, now = new Date(), log = () => { }) {
    const problems = [];
    const byName = new Map();
    for (const [path, pkg] of installedPackages(lock)) {
        if (pkg.version) {
            const name = packageName(path);
            byName.set(name, (byName.get(name) ?? new Set()).add(pkg.version));
        }
    }
    const limit = now.getTime() - MIN_RELEASE_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const [name, versions] of byName) {
        let times;
        try {
            times = (await fetchJson(`${NPM_REGISTRY}${name}`)).time;
        }
        catch (error) {
            log(`» ${name}: could not read its release dates (${error.message}); skipping its age check`);
            continue;
        }
        for (const version of versions) {
            const published = times?.[version];
            if (!published) {
                log(`» ${name}@${version}: no release date on the registry; skipping its age check`);
                continue;
            }
            if (new Date(published).getTime() > limit) {
                problems.push(`${name}@${version} was published on ${published.slice(0, 10)}, less than ${MIN_RELEASE_AGE_DAYS} days ago: wait, or use an older version`);
            }
        }
    }
    return problems;
}
export async function fetchJsonWithTimeout(url, timeoutMs = 30_000) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
    });
    if (!response.ok) {
        throw new Error(`${url}: HTTP ${response.status}`);
    }
    return response.json();
}
