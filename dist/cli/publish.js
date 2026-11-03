/**
 * bd publish: writes manifest.json on a work branch of the qa folder, commits it and pushes the
 * ticket branches and the work branch. It never pushes qa, and it creates no tags: the
 * publication reaches players when the pull request into qa is merged, after its checks pass, and
 * the merge (the project workflow's `tag` job) tags the ticket commits and the publication. So
 * nothing permanent exists before the merge: running bd publish again only redoes the pushes, and
 * `bd publish --abort` undoes a publication that was not pushed yet.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from '../contract/archive.js';
import { compareVersions } from '../contract/manifest.js';
import { SEMVER, buildManifest } from './manifest.js';
import { gitIn } from './git.js';
import { run } from './process.js';
/** owner/name of a GitHub remote URL (SSH or HTTPS). */
export function repositoryFromRemote(url) {
    const match = /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.trim());
    if (!match) {
        throw new Error(`The origin remote is not a GitHub repository: ${url}`);
    }
    return match[1];
}
/** The manifest committed at `ref`, or undefined when there is none. */
async function manifestAt(qaDir, ref) {
    const result = await run('git', ['-c', 'safe.directory=*', '-C', qaDir, 'show', `${ref}:manifest.json`]);
    return result.code === 0 ? JSON.parse(result.stdout.toString('utf8')) : undefined;
}
/** The local publication of `version` at HEAD: its manifest, when HEAD is the "Publish" commit of that version. */
async function localPublication(git, qaDir, version) {
    const subject = await git.text('log', '-1', '--format=%s');
    if (!/^Publish .* \d+\.\d+\.\d+$/.test(subject) || !subject.endsWith(` ${version}`)) {
        return null;
    }
    const manifest = await manifestAt(qaDir, 'HEAD');
    if (!manifest || manifest.version !== version) {
        return null;
    }
    // Once the pull request is merged, the same commit is on qa: that publication is over, and a
    // work branch still sitting on it must publish a newer version.
    for (const qa of ['refs/heads/qa', 'refs/remotes/origin/qa']) {
        const merged = await run('git', ['-c', 'safe.directory=*', '-C', qaDir, 'merge-base', '--is-ancestor', 'HEAD', qa]);
        if (merged.code === 0) {
            return null;
        }
    }
    return manifest;
}
function workBranchOf(branch, version) {
    if (branch === 'qa' || branch === 'HEAD') {
        throw new Error(`Publish from a work branch, not from ${branch}: create one first, for example "git switch -c publish/${version}"`);
    }
}
export async function publishProject(options) {
    const { qaDir, version, dryRun = false, push = true, log } = options;
    const git = gitIn(qaDir);
    if (!SEMVER.test(version)) {
        throw new Error(`Invalid version ${version}: use X.Y.Z`);
    }
    const branch = await git.text('rev-parse', '--abbrev-ref', 'HEAD');
    workBranchOf(branch, version);
    const repository = options.repository ?? repositoryFromRemote(await git.text('remote', 'get-url', 'origin'));
    const prUrl = `https://github.com/${repository}/compare/qa...${branch}?expand=1`;
    // A publication already committed on this branch (a push failed, or the author runs it again):
    // only the pushes are left, as long as the tickets still match what was committed.
    const committed = await localPublication(git, qaDir, version);
    let manifest;
    if (committed) {
        const rebuilt = await buildManifest({ qaDir, version, now: committed.createdAt });
        if (JSON.stringify(rebuilt.entries) !== JSON.stringify(committed.entries)) {
            throw new Error(`The publication ${version} committed on ${branch} does not match tickets/ any more: run "bd publish --abort --version ${version}" and publish again`);
        }
        if (dryRun) {
            return { manifest: committed, prUrl };
        }
        log(`Publication ${version} is already committed on ${branch}: pushing`);
        manifest = committed;
    }
    else {
        const published = await readFile(join(qaDir, 'manifest.json'), 'utf8').then((text) => JSON.parse(text).version, () => undefined);
        if (published && SEMVER.test(published) && compareVersions(version, published) <= 0) {
            throw new Error(`The version must be newer than the published ${published} (got ${version})`);
        }
        // Players download the committed tickets/, so the manifest must describe exactly those files.
        const dirty = await git.text('status', '--porcelain', '--', 'tickets');
        if (dirty) {
            throw new Error(`Commit the ticket files first; these are not committed:\n${dirty}`);
        }
        manifest = await buildManifest({ qaDir, version });
        if (dryRun) {
            return { manifest, prUrl };
        }
        const manifestPath = join(qaDir, 'manifest.json');
        await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        await git.text('add', 'manifest.json');
        // Only the manifest: anything else the author has staged stays staged.
        await git.text('commit', '-q', '-m', `Publish ${manifest.project.name} ${version}`, '--', 'manifest.json');
        log(`manifest.json committed on ${branch} (sha256 ${sha256Hex(await readFile(manifestPath)).slice(0, 12)})`);
    }
    if (push) {
        const branches = manifest.entries.map((entry) => entry.branch);
        const pushes = [
            ['push', '--force-with-lease', 'origin', ...branches],
            ['push', '--set-upstream', 'origin', branch],
        ];
        for (const [index, args] of pushes.entries()) {
            try {
                await git.text(...args);
            }
            catch (error) {
                const left = pushes.slice(index).map((rest) => `  git ${rest.join(' ')}`);
                throw new Error(`${error.message}\n\nThe publication is committed locally. Fix the cause, then run "bd publish --version ${version}" again (it only redoes the pushes), or by hand:\n${left.join('\n')}`, { cause: error });
            }
        }
        log(`Pushed ${branches.join(' ')} and ${branch}; the merge tags the publication`);
    }
    log(`Open the pull request into qa: ${prUrl}`);
    return { manifest, prUrl };
}
/**
 * bd publish --abort: undoes the local publication of `version` on the work branch (the "Publish"
 * commit and the manifest it wrote), as long as that commit was never pushed. Local ticket tags of
 * that version left by older versions of bd are removed too.
 */
export async function abortPublication({ qaDir, version, log }) {
    const git = gitIn(qaDir);
    if (!SEMVER.test(version)) {
        throw new Error(`Invalid version ${version}: use X.Y.Z`);
    }
    const branch = await git.text('rev-parse', '--abbrev-ref', 'HEAD');
    workBranchOf(branch, version);
    if (!(await localPublication(git, qaDir, version))) {
        throw new Error(`HEAD of ${branch} is not the publication of ${version}: nothing to abort`);
    }
    if (await git.text('status', '--porcelain', '--', 'manifest.json')) {
        throw new Error('manifest.json has uncommitted changes: restore or commit them first');
    }
    if (await git.text('branch', '-r', '--contains', 'HEAD')) {
        throw new Error(`The publication ${version} was already pushed: close its pull request and publish the next version instead`);
    }
    await git.text('reset', '-q', '--soft', 'HEAD~1');
    const before = await run('git', ['-c', 'safe.directory=*', '-C', qaDir, 'cat-file', '-e', 'HEAD:manifest.json']);
    if (before.code === 0) {
        await git.text('restore', '--source=HEAD', '--staged', '--worktree', 'manifest.json');
    }
    else {
        await git.text('rm', '-q', '--cached', 'manifest.json');
        await rm(join(qaDir, 'manifest.json'), { force: true });
    }
    log(`Removed the "Publish" commit of ${version} from ${branch}; manifest.json is back to the published one`);
    const tags = (await git.text('tag', '-l', `*-v${version}`)).split('\n').filter(Boolean);
    for (const tag of tags) {
        await git.text('tag', '-d', tag);
    }
    if (tags.length > 0) {
        log(`Removed the local tags ${tags.join(' ')}`);
    }
}
