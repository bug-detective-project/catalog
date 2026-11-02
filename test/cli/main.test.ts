import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const bd = (...args: string[]) =>
  spawnSync(process.execPath, [new URL('../../src/cli/main.ts', import.meta.url).pathname, ...args], {
    encoding: 'utf8',
  });

describe('the bd command', () => {
  it('lists its commands with --help', () => {
    const result = bd('--help');
    expect(result.status).toBe(0);
    for (const command of ['build', 'verify', 'validate', 'publish']) {
      expect(result.stdout).toContain(`bd ${command}`);
    }
  });

  it('exits with 2 on an unknown command', () => {
    const result = bd('deploy');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Unknown command: deploy');
  });
});
