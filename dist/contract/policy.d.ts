/**
 * What a project may ask of the player's machine. The workspace runs in a container, but two
 * things reach the player's PC itself: the VS Code extensions a project recommends (UI extensions
 * run on the PC) and the texts the player reads (a text can ask them to run a command outside the
 * workspace). Both lists change only through a pull request to this repository; bd validate
 * applies them to every publication.
 */
/** Extensions a project may recommend in .vscode/extensions.json (ids in lower case). */
export declare const ALLOWED_VSCODE_EXTENSIONS: readonly string[];
/** Files a project may ship in .vscode/. */
export declare const ALLOWED_VSCODE_FILES: readonly string[];
export interface DangerousPattern {
    pattern: RegExp;
    reason: string;
}
/**
 * Commands a ticket, hint, solution, review or story text must never ask the player to run: they
 * run on the PC, where the workspace isolation does not help. Commands against the project's own
 * app (localhost, 127.0.0.1) are fine: debugging it is the game.
 */
export declare const DANGEROUS_TEXT_PATTERNS: readonly DangerousPattern[];
export interface DangerousCommand {
    /** 1-based line of the text. */
    line: number;
    match: string;
    reason: string;
}
/** The dangerous commands of a text, with their line. */
export declare function findDangerousCommands(text: string): DangerousCommand[];
export interface TextFile {
    path: string;
    text: string;
}
/** Problems of a project's .vscode/ files: a file outside the list, or a recommendation outside the list. */
export declare function vscodeProblems(files: readonly TextFile[]): string[];
/** The dangerous commands of a project's texts (markdown, hints and story), as "path:line: match (reason)". */
export declare function textProblems(files: readonly TextFile[]): string[];
