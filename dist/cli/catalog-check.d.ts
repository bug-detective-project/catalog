import type { ProjectManifest } from '../contract/manifest.ts';
import type { ValidateRemoteOptions } from './remote.ts';
export interface CheckCatalogOptions {
    file: string;
    validate?: (options: ValidateRemoteOptions) => Promise<ProjectManifest>;
    log?: (line: string) => void;
}
/**
 * Validates projects.json, then every listed project as players download it; reports every broken
 * one. Also checks the order of the cards (the starter, then levels that never go down) and that a
 * project with ticket types other than fix asks for an app that knows them.
 */
export declare function checkCatalog({ file, validate, log, }: CheckCatalogOptions): Promise<void>;
