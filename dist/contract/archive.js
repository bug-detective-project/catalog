/**
 * Archive helpers shared by the desktop app and the bd CLI: tar and zip reading/writing, path
 * safety and SHA-256 tree digests.
 */
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { extract, pack } from 'tar-stream';
export class UnsafeArchiveError extends Error {
}
/** Validates an archive entry path: relative, no `..`, no drive letters or backslashes. */
export function safeRelativePath(raw) {
    const path = raw.replace(/^\.\//, '');
    const segments = path.split('/');
    const unsafe = path === '' ||
        path.startsWith('/') ||
        path.includes('\\') ||
        path.includes('\0') ||
        /^[A-Za-z]:/.test(path) ||
        segments.some((segment) => segment === '..' || segment === '.' || segment === '');
    if (unsafe) {
        throw new UnsafeArchiveError(`Unsafe path in archive: ${JSON.stringify(raw)}`);
    }
    return path;
}
export function sha256Hex(data) {
    return createHash('sha256').update(data).digest('hex');
}
/**
 * Digest of a set of files that does not depend on the archive format: SHA-256 over the sorted
 * lines "<sha256 of content>  <path>". The same tree gives the same digest from git archive,
 * a GitHub zip or an extracted folder.
 */
export function treeDigest(files) {
    const lines = [...files]
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map((file) => `${sha256Hex(file.data)}  ${file.path}\n`)
        .join('');
    return `sha256:${sha256Hex(lines)}`;
}
/** Reads the regular files of a tar archive (for example `git archive --format=tar`). */
export async function readTar(input) {
    const files = [];
    const extractor = extract();
    const done = new Promise((resolve, reject) => {
        extractor.on('entry', (header, stream, next) => {
            const chunks = [];
            stream.on('data', (chunk) => chunks.push(chunk));
            stream.on('end', () => {
                if (header.type === 'file') {
                    files.push({
                        path: safeRelativePath(header.name),
                        data: new Uint8Array(Buffer.concat(chunks)),
                        executable: ((header.mode ?? 0o644) & 0o111) !== 0,
                    });
                }
                next();
            });
            stream.on('error', reject);
            stream.resume();
        });
        extractor.on('finish', resolve);
        extractor.on('error', reject);
    });
    const source = input instanceof Uint8Array ? Readable.from([Buffer.from(input)]) : input;
    source.on('error', (error) => extractor.destroy(error));
    source.pipe(extractor);
    await done;
    return files;
}
/** Writes files as a tar archive (used to stream a snapshot into the workspace container). */
export async function writeTar(files) {
    const packer = pack();
    const chunks = [];
    packer.on('data', (chunk) => chunks.push(chunk));
    const finished = new Promise((resolve, reject) => {
        packer.on('end', resolve);
        packer.on('error', reject);
    });
    for (const file of files) {
        await new Promise((resolve, reject) => packer.entry({ name: file.path, mode: file.executable ? 0o755 : 0o644, mtime: new Date(0), size: file.data.length }, Buffer.from(file.data), (error) => (error ? reject(error) : resolve())));
    }
    packer.finalize();
    await finished;
    return Buffer.concat(chunks);
}
/** Defaults of readZip's limits: far above any stage package or save, far below what would exhaust memory. */
export const ZIP_LIMITS = { maxBytes: 1024 * 1024 * 1024, maxEntries: 100_000 };
/**
 * Reads a zip archive. With `stripTopDirectory`, the single top-level folder that GitHub puts in
 * branch archives (`repo-branch/`) is removed from every path. The sizes the archive declares are
 * checked before anything is extracted (a zip bomb is refused, not inflated): fflate allocates each
 * entry at its declared size and never writes past it.
 */
export function readZip(bytes, options = {}) {
    const { maxBytes, maxEntries } = { ...ZIP_LIMITS, ...options };
    let total = 0;
    let count = 0;
    const unzipped = unzipSync(bytes, {
        filter: (entry) => {
            total += entry.originalSize;
            count += 1;
            if (total > maxBytes || count > maxEntries) {
                throw new UnsafeArchiveError(`The archive is too large when extracted (more than ${maxBytes} bytes or ${maxEntries} files)`);
            }
            return true;
        },
    });
    const entries = Object.entries(unzipped).filter(([name]) => !name.endsWith('/'));
    let prefix = '';
    if (options.stripTopDirectory) {
        const tops = new Set(entries.map(([name]) => name.split('/')[0]));
        if (tops.size !== 1 || entries.some(([name]) => !name.includes('/'))) {
            throw new UnsafeArchiveError('Expected a single top-level folder in the archive');
        }
        prefix = `${[...tops][0]}/`;
    }
    return entries.map(([name, data]) => ({
        path: safeRelativePath(name.slice(prefix.length)),
        data,
        executable: false,
    }));
}
/** Writes a deterministic zip: sorted entries and a fixed timestamp, so the checksum is stable. */
export function writeZip(files) {
    const tree = {};
    for (const file of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
        tree[safeRelativePath(file.path)] = [file.data, { mtime: new Date('2000-01-01T00:00:00Z'), level: 9 }];
    }
    return zipSync(tree);
}
export function textFile(path, text) {
    return { path, data: strToU8(text), executable: false };
}
export function fileText(file) {
    return strFromU8(file.data);
}
