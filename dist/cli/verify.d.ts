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
}) => Promise<QaResult>;
export interface VerifyOptions {
    qaDir: string;
    /** Default: every ticket. */
    ids?: string[];
    runQa?: RunQa;
}
/** The outcome of each gate: the result names the gate that failed or timed out (2 when passed). */
export declare function gatesOf(result: QaResult): Gates;
/** The project's QA CLI: `npm run qa` in the qa folder, with a JSON result. */
export declare const npmQa: RunQa;
export declare function verifyTickets({ qaDir, ids, runQa, }: VerifyOptions): Promise<{
    rows: VerifyRow[];
    ok: boolean;
}>;
/** The verification matrix as a Markdown table. */
export declare function formatTable(rows: readonly VerifyRow[]): string;
