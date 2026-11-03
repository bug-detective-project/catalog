#!/usr/bin/env node
/** The bd command: Bug Detective authoring tools, run inside a project's qa folder. */
import { parseArgs } from 'node:util';
import { buildTickets } from './build.ts';
import { checkCatalog } from './catalog-check.ts';
import { gitIn } from './git.ts';
import { abortPublication, publishProject } from './publish.ts';
import { validateRemote } from './remote.ts';
import { validateLocal } from './validate.ts';
import { formatTable, verifyTickets } from './verify.ts';

const HELP = `Usage: bd <command> [options]   (inside a project's qa folder)

  bd build [--base main]                 regenerate every gate1/ and rebuild the ticket branches
  bd verify [ticket ids...]              buggy: Gate 1 passes, Gate 2 fails; fixed: both pass
  bd validate [--base-ref origin/qa]     check the committed manifest, the ticket branches and tags
  bd validate --remote <owner/repo> [--ref qa] [--project <id>]
                                         check a project as players download it from GitHub
  bd publish --version X.Y.Z [--dry-run] write and commit the manifest, push the ticket branches and
                                         the work branch (never qa; the merge tags the publication)
  bd publish --abort --version X.Y.Z     undo a publication that was committed but not pushed
  bd catalog-check [--file projects.json]
                                         check the catalog and every listed project (catalog repository)
`;

const log = (line: string) => console.log(line);

async function qaFolder(): Promise<string> {
  return gitIn(process.cwd()).text('rev-parse', '--show-toplevel');
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    console.log(HELP);
    return 0;
  }
  switch (command) {
    case 'build': {
      const { values } = parseArgs({ args: rest, options: { base: { type: 'string', default: 'main' } } });
      await buildTickets({ qaDir: await qaFolder(), base: values.base, log });
      return 0;
    }
    case 'verify': {
      const { positionals } = parseArgs({ args: rest, allowPositionals: true });
      const { rows, ok } = await verifyTickets({
        qaDir: await qaFolder(),
        ids: positionals.length > 0 ? positionals : undefined,
        log,
      });
      for (const row of rows.filter((item) => !item.ok)) {
        console.error(`${row.id}: unexpected result\n${row.logs ?? ''}`);
      }
      console.log(formatTable(rows));
      return ok ? 0 : 1;
    }
    case 'validate': {
      const { values } = parseArgs({
        args: rest,
        options: {
          remote: { type: 'string' },
          ref: { type: 'string', default: 'qa' },
          project: { type: 'string' },
          'base-ref': { type: 'string', default: 'origin/qa' },
        },
      });
      const manifest = values.remote
        ? await validateRemote({ repository: values.remote, ref: values.ref, project: values.project })
        : await validateLocal({ qaDir: await qaFolder(), baseRef: values['base-ref'] });
      log(
        `${manifest.project.name} ${manifest.version}: ${manifest.tickets.front} front + ${manifest.tickets.back} back tickets, valid`,
      );
      return 0;
    }
    case 'publish': {
      const { values } = parseArgs({
        args: rest,
        options: {
          version: { type: 'string' },
          'dry-run': { type: 'boolean', default: false },
          abort: { type: 'boolean', default: false },
        },
      });
      if (!values.version) {
        console.error('bd publish needs --version X.Y.Z');
        return 2;
      }
      if (values.abort) {
        await abortPublication({ qaDir: await qaFolder(), version: values.version, log });
        return 0;
      }
      await publishProject({ qaDir: await qaFolder(), version: values.version, dryRun: values['dry-run'], log });
      return 0;
    }
    case 'catalog-check': {
      const { values } = parseArgs({ args: rest, options: { file: { type: 'string', default: 'projects.json' } } });
      await checkCatalog({ file: values.file, log });
      return 0;
    }
    default:
      console.error(`Unknown command: ${command}\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
