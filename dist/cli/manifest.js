/** Builds a project's manifest from its qa folder (a worktree of the qa branch) and its ticket branches. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { treeDigest } from '../contract/archive.js';
import { PACKAGE_EXCLUDED, SUPPORTED_FORMAT_VERSION, parseManifest, projectStackSchema } from '../contract/manifest.js';
import { projectContentOf } from '../contract/project-files.js';
import { gitArchive, gitIn, normalizeLineEndings, resolveBranchRef } from './git.js';
import { ticketQueue, trackedTicketFiles } from './tickets.js';
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];
/** bugDetective.project of the qa folder's package.json. */
export async function readProject(qaDir) {
    let json;
    try {
        json = JSON.parse(await readFile(join(qaDir, 'package.json'), 'utf8'));
    }
    catch {
        throw new Error(`${qaDir}/package.json is missing or is not valid JSON`);
    }
    const project = json.bugDetective?.project;
    if (typeof project?.id !== 'string' || typeof project.name !== 'string') {
        throw new Error(`${qaDir}/package.json has no bugDetective.project { id, name }`);
    }
    const { difficulty } = project;
    if (difficulty !== undefined && !DIFFICULTIES.includes(difficulty)) {
        throw new Error(`${qaDir}/package.json: bugDetective.project.difficulty must be one of ${DIFFICULTIES.join(', ')}`);
    }
    let stack;
    if (project.stack !== undefined) {
        const parsed = projectStackSchema.safeParse(project.stack);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            throw new Error(`${qaDir}/package.json: bugDetective.project.stack${issue?.path.length ? `.${issue.path.join('.')}` : ''}: ${issue?.message ?? 'invalid'}`);
        }
        stack = parsed.data;
    }
    return {
        id: project.id,
        name: project.name,
        ...(difficulty !== undefined && { difficulty: difficulty }),
        ...(stack !== undefined && { stack }),
    };
}
/** Files and folders every tickets/<id>/ must have. */
export const REQUIRED_TICKET_FILES = [
    'bug.patch',
    'gate1/',
    'gate2/',
    'ticket.en.md',
    'ticket.pt.md',
    'hints.en.json',
    'hints.pt.json',
    'reference.patch',
    'review.en.md',
    'review.pt.md',
    'solution.en.md',
    'solution.pt.md',
];
export const SEMVER = /^\d+\.\d+\.\d+$/;
/**
 * The player's package of a ticket: its committed files (the blobs GitHub serves, so the digest
 * matches the download byte for byte) without PACKAGE_EXCLUDED.
 */
function ticketPackage(id, files, committed) {
    const prefix = `tickets/${id}/`;
    const own = files.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length));
    for (const required of REQUIRED_TICKET_FILES) {
        const present = required.endsWith('/') ? own.some((file) => file.startsWith(required)) : own.includes(required);
        if (!present) {
            throw new Error(`tickets/${id} has no ${required}`);
        }
    }
    return committed
        .filter((file) => file.path.startsWith(prefix) && !PACKAGE_EXCLUDED.has(file.path.slice(prefix.length)))
        .map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
}
/**
 * Every committed file of the qa folder, read from disk with LF line endings (the content a
 * download of the qa branch gives, before it is published).
 */
export async function readQaFiles(qaDir) {
    const paths = (await gitIn(qaDir).text('ls-files', '-z')).split('\0').filter(Boolean);
    const files = [];
    for (const path of paths) {
        const data = await readFile(join(qaDir, ...path.split('/'))).catch(() => null);
        if (data) {
            files.push({ path, data: new Uint8Array(normalizeLineEndings(data)), executable: false });
        }
    }
    return files;
}
/** Reads the qa folder and the ticket branches into a manifest. Writes nothing. */
export async function buildManifest({ qaDir, version, now }) {
    if (!SEMVER.test(version)) {
        throw new Error(`Invalid version ${version}: use X.Y.Z`);
    }
    const project = await readProject(qaDir);
    const git = gitIn(qaDir);
    // The story and the review configuration must be valid before anything is published.
    const projectFiles = (await readQaFiles(qaDir)).filter((file) => !file.path.startsWith('tickets/'));
    projectContentOf(projectFiles);
    const files = await trackedTicketFiles(git);
    const queue = ticketQueue([...new Set(files.map((file) => file.split('/')[1]))]);
    if (queue.length === 0) {
        throw new Error(`${qaDir}/tickets has no ticket folders`);
    }
    const committed = await gitArchive(qaDir, 'HEAD');
    const entries = [];
    for (const id of queue) {
        const packageFiles = ticketPackage(id, files, committed);
        const ref = await resolveBranchRef(qaDir, id);
        const commit = await git.text('rev-parse', `${ref}^{commit}`);
        const codeFiles = await gitArchive(qaDir, commit);
        const existing = (await git.text('tag', '--points-at', commit, '--sort=-v:refname', '-l', `${id}-v*`))
            .split('\n')
            .filter(Boolean)[0];
        const [track, order] = id.split('-');
        entries.push({
            id,
            track: track,
            order: Number(order),
            branch: id,
            tag: existing ?? `${id}-v${version}`,
            commit,
            commitMessage: await git.text('log', '-1', '--format=%s', commit),
            codeDigest: treeDigest(codeFiles),
            codeFiles: codeFiles.length,
            package: { path: `tickets/${id}`, files: packageFiles.length, digest: treeDigest(packageFiles) },
        });
    }
    return parseManifest({
        format: 'bug-detective-project',
        formatVersion: SUPPORTED_FORMAT_VERSION,
        project,
        version,
        createdAt: now ?? new Date().toISOString(),
        tickets: {
            total: entries.length,
            front: entries.filter((entry) => entry.track === 'front').length,
            back: entries.filter((entry) => entry.track === 'back').length,
        },
        entries,
    });
}
