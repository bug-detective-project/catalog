/** bd catalog-check: the catalog's own check, on every pull request and every day. */
import { readFile } from 'node:fs/promises';
import { parseCatalog } from '../contract/catalog.js';
import { validateRemote } from './remote.js';
/** Validates projects.json, then every listed project as players download it; reports every broken one. */
export async function checkCatalog({ file, validate = validateRemote, log = () => { }, }) {
    const catalog = parseCatalog(JSON.parse(await readFile(file, 'utf8')));
    const problems = [];
    for (const project of catalog.projects) {
        try {
            const manifest = await validate({ repository: project.repository, ref: project.qaRef, project: project.id });
            log(`${project.id}: ${manifest ? `${manifest.version}, ` : ''}valid`);
        }
        catch (error) {
            problems.push(`${project.id}: ${error.message}`);
        }
    }
    if (problems.length > 0) {
        throw new Error(problems.join('\n'));
    }
}
