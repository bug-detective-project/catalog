/**
 * bd validate --remote: checks a project as players download it from GitHub. Each ticket is checked
 * through its tag (<id>-v<version>), which keeps the published commit reachable; the ticket branch
 * tip is never used, because bd publish moves it before the qa pull request is merged.
 */
import { fileText, readZip } from '../contract/archive.js';
import { parseManifest } from '../contract/manifest.js';
import { projectContentOf } from '../contract/project-files.js';
import { packageOf, verifyCode, verifyPackage } from '../contract/verify.js';
import { runChecked } from './process.js';
const GITHUB = 'https://github.com';
export class HttpError extends Error {
    status;
    constructor(url, status) {
        super(`${url} answered ${status}`);
        this.status = status;
    }
}
export const fetchZipFromGitHub = async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
        throw new HttpError(url, response.status);
    }
    return new Uint8Array(await response.arrayBuffer());
};
/** The tags of a public repository and the commit each one points to (annotated tags peeled). */
export const lsRemoteTagsFromGitHub = async (repository) => {
    const { stdout } = await runChecked('git', ['ls-remote', '--tags', `${GITHUB}/${repository}.git`]);
    const tags = new Map();
    for (const line of stdout.toString('utf8').split('\n').filter(Boolean)) {
        const [commit, ref] = line.split('\t');
        const name = ref.replace('refs/tags/', '');
        if (name.endsWith('^{}')) {
            tags.set(name.slice(0, -3), commit);
        }
        else if (!tags.has(name)) {
            tags.set(name, commit);
        }
    }
    return tags;
};
/** The archive of a branch, or of a tag when no branch has that name. */
async function refZip(repository, ref, fetchZip) {
    try {
        return await fetchZip(`${GITHUB}/${repository}/archive/refs/heads/${encodeURIComponent(ref)}.zip`);
    }
    catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404)
            throw error;
        return fetchZip(`${GITHUB}/${repository}/archive/refs/tags/${encodeURIComponent(ref)}.zip`);
    }
}
export async function validateRemote({ repository, ref = 'qa', project, fetchZip = fetchZipFromGitHub, lsRemoteTags = lsRemoteTagsFromGitHub, }) {
    const qaFiles = readZip(await refZip(repository, ref, fetchZip), { stripTopDirectory: true });
    const manifestFile = qaFiles.find((file) => file.path === 'manifest.json');
    if (!manifestFile) {
        throw new Error(`${repository}@${ref} has no manifest.json`);
    }
    const manifest = parseManifest(JSON.parse(fileText(manifestFile)), project);
    projectContentOf(qaFiles.filter((file) => !file.path.startsWith('tickets/')));
    const problems = [];
    const tags = await lsRemoteTags(repository);
    for (const entry of manifest.entries) {
        try {
            verifyPackage(entry, packageOf(entry, qaFiles));
        }
        catch (error) {
            problems.push(error.message);
        }
        const tagged = tags.get(entry.tag);
        if (tagged === undefined) {
            problems.push(`${entry.id}: the tag ${entry.tag} is not published`);
            continue;
        }
        if (tagged !== entry.commit) {
            problems.push(`${entry.id}: the tag ${entry.tag} points to ${tagged.slice(0, 12)}, not to the manifest's ${entry.commit.slice(0, 12)}`);
            continue;
        }
        try {
            verifyCode(entry, readZip(await fetchZip(`${GITHUB}/${repository}/archive/${entry.commit}.zip`), { stripTopDirectory: true }));
        }
        catch (error) {
            problems.push(error.message);
        }
    }
    if (problems.length > 0) {
        throw new Error(`${repository}@${ref} (${manifest.version}):\n${problems.join('\n')}`);
    }
    return manifest;
}
