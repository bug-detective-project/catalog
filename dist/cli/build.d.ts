export interface BuildOptions {
    qaDir: string;
    /** The ref the ticket branches are built from. */
    base?: string;
    log: (line: string) => void;
}
export declare function buildTickets({ qaDir, base, log }: BuildOptions): Promise<void>;
