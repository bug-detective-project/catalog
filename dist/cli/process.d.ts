export interface RunResult {
    code: number;
    stdout: Buffer;
    stderr: Buffer;
}
export interface RunOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /** Only for Windows batch files (npm.cmd), which Node cannot start without a shell. */
    shell?: boolean;
}
export declare function run(command: string, args: readonly string[], options?: RunOptions): Promise<RunResult>;
/** Like run, but a non-zero exit is an error that carries the command's stderr. */
export declare function runChecked(command: string, args: readonly string[], options?: RunOptions): Promise<RunResult>;
