/**
 * What a project may ask of the player's machine. The workspace runs in a container, but two
 * things reach the player's PC itself: the VS Code extensions a project recommends (UI extensions
 * run on the PC) and the texts the player reads (a text can ask them to run a command outside the
 * workspace). Both lists change only through a pull request to this repository; bd validate
 * applies them to every publication.
 */
/** Extensions a project may recommend in .vscode/extensions.json (ids in lower case). */
export const ALLOWED_VSCODE_EXTENSIONS = [
    'dbaeumer.vscode-eslint',
    'esbenp.prettier-vscode',
    'vitest.explorer',
];
/** Files a project may ship in .vscode/. */
export const ALLOWED_VSCODE_FILES = ['settings.json', 'extensions.json', 'launch.json'];
/**
 * Commands a ticket, hint, solution, review or story text must never ask the player to run: they
 * run on the PC, where the workspace isolation does not help. Commands against the project's own
 * app (localhost, 127.0.0.1) are fine: debugging it is the game.
 */
export const DANGEROUS_TEXT_PATTERNS = [
    { pattern: /\|\s*(?:sh|bash|zsh|iex)\b/i, reason: 'pipes a download into a shell' },
    { pattern: /\bInvoke-Expression\b/i, reason: 'runs text as PowerShell' },
    { pattern: /\b(?:powershell|pwsh)(?:\.exe)?\b/i, reason: 'runs PowerShell on the PC' },
    { pattern: /\bcmd(?:\.exe)?\s+\/[ck]\b/i, reason: 'runs cmd.exe on the PC' },
    { pattern: /-EncodedCommand\b/i, reason: 'runs an encoded PowerShell command' },
    {
        pattern: /\b(?:curl|wget)\b[^\n]*\bhttps?:\/\/(?!localhost\b|127\.0\.0\.1\b)/i,
        reason: 'downloads from outside the workspace app',
    },
    { pattern: /\b(?:Invoke-WebRequest|iwr)\b/i, reason: 'downloads with PowerShell' },
    { pattern: /\bnpm\s+(?:install|i|add)\s+(?:-g|--global)\b/i, reason: 'installs a package globally on the PC' },
    { pattern: /\b(?:winget|choco|scoop)\b/i, reason: 'installs software on the PC' },
];
/** The dangerous commands of a text, with their line. */
export function findDangerousCommands(text) {
    const found = [];
    text.split('\n').forEach((content, index) => {
        for (const { pattern, reason } of DANGEROUS_TEXT_PATTERNS) {
            const match = pattern.exec(content);
            if (match) {
                found.push({ line: index + 1, match: match[0].trim(), reason });
            }
        }
    });
    return found;
}
/** Problems of a project's .vscode/ files: a file outside the list, or a recommendation outside the list. */
export function vscodeProblems(files) {
    const problems = [];
    for (const file of files) {
        if (!file.path.startsWith('.vscode/')) {
            continue;
        }
        const name = file.path.slice('.vscode/'.length);
        if (!ALLOWED_VSCODE_FILES.includes(name)) {
            problems.push(`${file.path}: only ${ALLOWED_VSCODE_FILES.join(', ')} may be shipped in .vscode/`);
            continue;
        }
        if (name !== 'extensions.json') {
            continue;
        }
        let recommendations;
        try {
            recommendations = JSON.parse(file.text).recommendations;
        }
        catch {
            problems.push(`${file.path}: not valid JSON`);
            continue;
        }
        for (const id of Array.isArray(recommendations) ? recommendations : []) {
            if (typeof id !== 'string' || !ALLOWED_VSCODE_EXTENSIONS.includes(id.toLowerCase())) {
                problems.push(`${file.path}: the extension ${String(id)} is not allowed (allowed: ${ALLOWED_VSCODE_EXTENSIONS.join(', ')}; change the list in the catalog repository)`);
            }
        }
    }
    return problems;
}
/** The dangerous commands of a project's texts (markdown, hints and story), as "path:line: match (reason)". */
export function textProblems(files) {
    const problems = [];
    for (const file of files) {
        for (const { line, match, reason } of findDangerousCommands(file.text)) {
            problems.push(`${file.path}:${line}: "${match}" ${reason}; texts may only ask for commands in the VS Code terminal against the workspace app`);
        }
    }
    return problems;
}
