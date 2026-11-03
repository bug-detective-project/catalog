/**
 * Rules for the npm dependencies of a project (main and every ticket branch), applied by
 * bd validate to every publication. The lockfile is installed on the player's machine (inside the
 * workspace container, with the network on), so it is the quietest place to hide code: a package
 * from an odd host, an install script, or a version published minutes ago. The lists change only
 * through a pull request to this repository.
 */
/** Packages whose install scripts a project may allow in its package.json `allowScripts`. */
export const ALLOWED_INSTALL_SCRIPTS = ['better-sqlite3'];
/** A version must have been on the registry for this long before a project may depend on it. */
export const MIN_RELEASE_AGE_DAYS = 7;
/** The .npmrc every project with dependencies ships on main and on every ticket branch. */
export const REQUIRED_NPMRC = {
    'allow-git': 'none',
    'allow-remote': 'none',
    'min-release-age': String(MIN_RELEASE_AGE_DAYS),
};
export const NPM_REGISTRY = 'https://registry.npmjs.org/';
