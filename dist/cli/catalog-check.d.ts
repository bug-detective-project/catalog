import type { ProjectManifest } from '../contract/manifest.ts';
import type { ValidateRemoteOptions } from './remote.ts';
export interface CheckCatalogOptions {
    file: string;
    validate?: (options: ValidateRemoteOptions) => Promise<ProjectManifest>;
    log?: (line: string) => void;
}
/** Validates projects.json, then every listed project as players download it; reports every broken one. */
export declare function checkCatalog({ file, validate, log, }: CheckCatalogOptions): Promise<void>;
