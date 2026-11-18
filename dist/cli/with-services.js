/**
 * bd with-services: runs a command with a project's services up. The CI of a project's main uses
 * it for npm test: the declaration lives on qa, so main carries a copy of it in a file.
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { projectServicesProblems } from '../contract/services.js';
import { startServices } from './services.js';
const spawnInherit = (command, env) => new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env, shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
});
async function readDeclaration(file) {
    let text;
    try {
        text = await readFile(file, 'utf8');
    }
    catch (error) {
        throw new Error(`${file}: cannot be read (${error.message})`);
    }
    let services;
    try {
        services = JSON.parse(text);
    }
    catch {
        throw new Error(`${file}: not valid JSON`);
    }
    const problem = projectServicesProblems({ services })[0];
    if (problem) {
        throw new Error(`${file}: ${problem}`);
    }
    return services;
}
/** Starts the services of the file, runs the command with their variables, and always stops them. */
export async function runWithServices(options, deps = {}) {
    if (options.command.length === 0) {
        throw new Error('bd with-services needs a command after --');
    }
    const services = await readDeclaration(options.file);
    const running = await (deps.start ?? startServices)(services, { project: options.project });
    try {
        return await (deps.run ?? spawnInherit)(options.command, { ...(deps.env ?? process.env), ...running.env });
    }
    finally {
        await running.stop();
    }
}
