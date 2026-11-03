export interface LockfilePackage {
    version?: string;
    resolved?: string;
    integrity?: string;
    link?: boolean;
    hasInstallScript?: boolean;
}
export interface Lockfile {
    lockfileVersion?: number;
    packages?: Record<string, LockfilePackage>;
}
export interface PackageJson {
    allowScripts?: Record<string, boolean>;
}
/** The name of a package from its lockfile path (`node_modules/@scope/name` → `@scope/name`). */
export declare function packageName(path: string): string;
/** The installed packages of a lockfile: the root and workspace links left out. */
export declare function installedPackages(lock: Lockfile): [string, LockfilePackage][];
/** Origins and integrity: every package from the public registry, with its integrity hash. */
export declare function lockfileOriginProblems(lock: Lockfile): string[];
/**
 * Install scripts: a package with one runs only when package.json allows it (npm's allowScripts),
 * and a project may only allow the packages of ALLOWED_INSTALL_SCRIPTS.
 */
export declare function installScriptProblems(lock: Lockfile, packageJson: PackageJson): string[];
/** The .npmrc of a project with dependencies: present, with the required keys and values. */
export declare function npmrcProblems(text: string | undefined): string[];
export type FetchJson = (url: string) => Promise<unknown>;
/** Versions published less than MIN_RELEASE_AGE_DAYS ago (typosquats and hijacked versions are usually caught within days). */
export declare function releaseAgeProblems(lock: Lockfile, fetchJson: FetchJson, now?: Date, log?: (line: string) => void): Promise<string[]>;
export declare function fetchJsonWithTimeout(url: string, timeoutMs?: number): Promise<unknown>;
