/**
 * bd validate: checks the qa folder before its pull request is merged. The committed
 * manifest.json must describe exactly the committed tickets, the ticket branches and their tags,
 * and its version must be newer than the published one.
 */
import { compareVersions, parseManifest } from '../contract/manifest.js';
import { buildManifest } from './manifest.js';
import { gitIn } from './git.js';
import { run } from './process.js';
/** The manifest.json committed at a ref, or undefined when the ref or the file does not exist. */
async function manifestAt(qaDir, ref) {
    const result = await run('git', ['-c', 'safe.directory=*', '-C', qaDir, 'show', `${ref}:manifest.json`]);
    return result.code === 0 ? JSON.parse(result.stdout.toString('utf8')) : undefined;
}
/** The fields of an entry that differ from what the ticket branch and folder give. */
function differences(published, rebuilt) {
    return Object.keys(rebuilt).filter((key) => JSON.stringify(published[key]) !== JSON.stringify(rebuilt[key]));
}
export async function validateLocal({ qaDir, baseRef = 'origin/qa' }) {
    const git = gitIn(qaDir);
    const problems = [];
    const dirty = await git.text('status', '--porcelain', '--', 'tickets');
    if (dirty) {
        problems.push(`These ticket files are not committed (players only get committed files):\n${dirty}`);
    }
    const raw = await manifestAt(qaDir, 'HEAD');
    if (raw === undefined) {
        throw new Error('The qa branch has no committed manifest.json: run bd publish first');
    }
    const manifest = parseManifest(raw);
    try {
        const rebuilt = await buildManifest({ qaDir, version: manifest.version, now: manifest.createdAt });
        if (rebuilt.project.id !== manifest.project.id ||
            JSON.stringify(rebuilt.tickets) !== JSON.stringify(manifest.tickets)) {
            problems.push('manifest.json does not list the tickets of tickets/: run bd publish again');
        }
        for (const entry of manifest.entries) {
            const fresh = rebuilt.entries.find((item) => item.id === entry.id);
            const changed = fresh ? differences(entry, fresh) : [];
            if (changed.length > 0) {
                problems.push(`${entry.id}: manifest.json does not match the ticket (${changed.join(', ')})`);
            }
        }
    }
    catch (error) {
        problems.push(error.message);
    }
    for (const entry of manifest.entries) {
        const tagged = await run('git', [
            '-c',
            'safe.directory=*',
            '-C',
            qaDir,
            'rev-parse',
            '--verify',
            '--quiet',
            `refs/tags/${entry.tag}^{commit}`,
        ]);
        const commit = tagged.stdout.toString('utf8').trim();
        if (tagged.code !== 0) {
            // Tags are created when the pull request is merged: before that, the commit must be the
            // ticket branch (locally or on origin).
            const onBranch = await run('git', [
                '-c',
                'safe.directory=*',
                '-C',
                qaDir,
                'branch',
                '-a',
                '--contains',
                entry.commit,
            ]);
            const branches = onBranch.stdout
                .toString('utf8')
                .split('\n')
                .map((line) => line.replace(/^\*?\s*/, '').replace(/^remotes\/origin\//, ''))
                .filter(Boolean);
            if (onBranch.code !== 0 || !branches.includes(entry.branch)) {
                problems.push(`${entry.id}: the tag ${entry.tag} does not exist and ${entry.commit.slice(0, 12)} is not on the branch ${entry.branch}`);
            }
        }
        else if (commit !== entry.commit) {
            problems.push(`${entry.id}: the tag ${entry.tag} points to ${commit.slice(0, 12)}, not to the manifest's ${entry.commit.slice(0, 12)}`);
        }
    }
    const baseExists = await run('git', [
        '-c',
        'safe.directory=*',
        '-C',
        qaDir,
        'rev-parse',
        '--verify',
        '--quiet',
        `${baseRef}^{commit}`,
    ]);
    if (baseExists.code !== 0) {
        throw new Error(`The base ref ${baseRef} does not exist: fetch it ("git fetch origin") or pass --base-ref`);
    }
    const base = await manifestAt(qaDir, baseRef);
    if (base !== undefined) {
        const published = base.version;
        if (typeof published === 'string' && compareVersions(manifest.version, published) <= 0) {
            // Housekeeping on qa (README, workflows, CODEOWNERS, .npmrc) is not a publication: the same
            // version is fine while the manifest and the tickets are exactly the published ones.
            const sameManifest = JSON.stringify(base) === JSON.stringify(raw);
            const ticketsDiff = await run('git', [
                '-c',
                'safe.directory=*',
                '-C',
                qaDir,
                'diff',
                '--quiet',
                baseRef,
                'HEAD',
                '--',
                'tickets',
            ]);
            if (!(sameManifest && ticketsDiff.code === 0)) {
                problems.push(`The version ${manifest.version} must be newer than ${published}, published on ${baseRef}`);
            }
        }
    }
    if (problems.length > 0) {
        throw new Error(problems.join('\n'));
    }
    return manifest;
}
