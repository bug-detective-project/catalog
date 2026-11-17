import type { RunningServices } from './services.ts';
import type { ProjectServices } from '../contract/services.ts';
export interface QaResult {
    gate: 1 | 2;
    status: 'passed' | 'failed' | 'timeout';
    /** What the QA tool printed, shown for unexpected rows. */
    output?: string;
}
export type GateOutcome = 'pass' | 'fail' | 'timeout' | 'not-run';
export type Gates = [GateOutcome, GateOutcome];
export interface VerifyRow {
    id: string;
    buggy: Gates;
    fixed: Gates | 'patch-failed';
    ok: boolean;
    /** The QA output of both runs, kept only when the row is unexpected. */
    logs?: string;
}
/** Runs the QA tool on a workspace; `position` is the ticket's place in the queue (1 = front-1). */
export type RunQa = (args: {
    qaDir: string;
    id: string;
    position: number;
    workspace: string;
    /** The variables of the project's services, when it declares any; added to the QA tool's environment. */
    env?: Record<string, string>;
}) => Promise<QaResult>;
/** How the services of a project are started and swept; replaced in tests. */
export interface VerifyServices {
    start: (services: ProjectServices, options: {
        project: string;
    }) => Promise<RunningServices>;
    sweep: () => Promise<string[]>;
}
export interface VerifyOptions {
    qaDir: string;
    /** Default: every ticket. */
    ids?: string[];
    runQa?: RunQa;
    services?: VerifyServices;
    /**
     * Registers what to do when the run is interrupted (Ctrl+C): remove the services of the QA run in
     * progress. Returns how to unregister it.
     */
    onInterrupt?: (handler: () => Promise<void>) => () => void;
    /** Progress, one line as each ticket starts and one as it ends (the table only comes at the end). */
    log?: (line: string) => void;
}
/** The outcome of each gate: the result names the gate that failed or timed out (2 when passed). */
export declare function gatesOf(result: QaResult): Gates;
/** How to start npm: on Windows it is npm.cmd, a batch file that needs a shell. */
export declare function npmInvocation(platform: NodeJS.Platform): {
    command: string;
    shell: boolean;
};
/** The project's QA CLI: `npm run qa` in the qa folder, with a JSON result. */
export declare const npmQa: RunQa;
export declare function verifyTickets({ qaDir, ids, runQa, services, onInterrupt, log, }: VerifyOptions): Promise<{
    rows: VerifyRow[];
    ok: boolean;
}>;
/** The verification matrix as a Markdown table. */
export declare function formatTable(rows: readonly VerifyRow[]): string;
