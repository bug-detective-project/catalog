# Bug Detective catalog

The list of Bug Detective's game projects, the content contract shared by the desktop app and the
authoring tools, and `bd`, the command authors and CI run on a project's `qa` branch.

Publishing a new version of a project changes only that project's repository. Adding, hiding or
reordering projects changes only `projects.json` here. The desktop app needs a new build only when
the content format changes.

Licensed under the PolyForm Noncommercial License 1.0.0 (see `LICENSE`).

## `projects.json`

The desktop app downloads this file from `main` when it starts, when the player takes a ticket and
when the Projects screen opens, and keeps the last good copy for offline use.
`raw.githubusercontent.com` caches files for up to about 5 minutes, so a change here can take that
long to reach players.

```json
{
  "projects": [{ "id": "supportdesk", "repository": "bug-detective-project/supportdesk", "starter": true }]
}
```

| Field           | Required           | Meaning                                                                                                                                                                                        |
| --------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | yes                | Equal to `project.id` in the project's manifest                                                                                                                                                |
| `repository`    | yes                | `bug-detective-project/<name>`: the project's public repository, always in the organization (a third-party project moves in before it is listed; see the desktop's `docs/adding-a-project.md`) |
| `qaRef`         | no (default `qa`)  | The branch or tag the content comes from                                                                                                                                                       |
| `starter`       | exactly one `true` | The project a new game starts with; it cannot be hidden                                                                                                                                        |
| `minAppVersion` | no                 | The oldest desktop version that can play the project (`X.Y.Z`)                                                                                                                                 |
| `hidden`        | no                 | Not offered to players who never played the project                                                                                                                                            |

The order of the list is the order of the cards on the Projects screen. Names, descriptions,
technologies, difficulty and ticket counts come from each project's `qa` branch. Versions are never
listed here: each project's `manifest.json` has its own.

In a project's `qa` branch, `package.json` holds `bugDetective.project`: `id`, `name`, the optional
`difficulty` (`beginner`, `intermediate` or `advanced`) and the optional `stack`
(`{ "frontend": "React · Vite", "backend": "Node.js · Express", "database": "SQLite" }`, any of the
three, up to 60 characters each). `bd build` and `bd publish` copy them into `manifest.json`. The
texts live in `story.en.json` and `story.pt.json`, including the optional `project.skills`: 1 to 5
skills the player practices, with the same count in every language (`bd validate` checks it).

Change `projects.json` through a pull request: the `catalog` check validates the file and every
listed project before the merge.

## The contract (`@bug-detective/catalog/contract`)

Schemas and checks shared by the desktop app and `bd`: the catalog, the project manifest
(`formatVersion`, currently 1; a newer one raises `UnsupportedFormatError`, which the app shows as
"update Bug Detective"), the story, `review.json`, archive digests, the verification of a ticket
package and its code against the manifest, and the archive path rules: besides `..`, absolute paths
and drive letters, a file name Windows cannot store (`:`, `< > " | ? *`, reserved device names such
as `CON` or `aux.ts`, a trailing dot or space) or two paths that differ only by case are refused,
because players extract the packages on their disk.

It also holds the project policy (`policy.ts`), applied by `bd validate` to every publication:
the VS Code extensions a project may recommend (`ALLOWED_VSCODE_EXTENSIONS`: ESLint, Prettier and
Vitest for now; UI extensions run on the player's PC, outside the workspace), the files allowed in
`.vscode/` (`settings.json`, `extensions.json`, `launch.json`), checked on `main` and on every
ticket branch, and the commands a ticket, hint, solution, review or story text must never ask the
player to run (`DANGEROUS_TEXT_PATTERNS`: downloads piped into a shell, PowerShell, `cmd /c`,
downloads from outside `localhost`, global installs). Commands against the project's own app are
fine. Changing a list is a pull request to this repository.

Depend on a tagged version, never on `main`:

```json
"@bug-detective/catalog": "github:bug-detective-project/catalog#v1.2.1"
```

`dist/` is committed, because Node does not run TypeScript from `node_modules` and pnpm does not
build git dependencies by default. To release a version: `npm run check`, `npm run build`, commit
`dist/`, then tag `vX.Y.Z` and push the tag. The `ci` check fails when `dist/` does not match the
sources.

## Dependency rules

Every project with dependencies (a `package-lock.json` on `main` or on a ticket branch) follows
these rules, applied by `bd validate` (the contract's `dependencies.ts`; a list changes only through a
pull request to this repository):

- every package comes from `https://registry.npmjs.org/` and has an integrity hash (no git or URL
  dependencies);
- `package.json` may allow install scripts (npm's `allowScripts`) only for the packages of
  `ALLOWED_INSTALL_SCRIPTS` (`better-sqlite3` today); other packages with scripts are fine, npm
  does not run them;
- every version has been on the registry for at least 7 days (`min-release-age`), read from the
  registry's `time` field; `--offline` skips this check;
- `.npmrc` on `main` and on every ticket branch sets `allow-git=none`, `allow-remote=none` and
  `min-release-age=7`, so the same rules protect the author's own `npm install`.

`npm audit` is not part of `bd validate`: it runs as a non-blocking step of the project's `main` CI.

## `bd`

Run inside a project's `qa` folder (a worktree of its `qa` branch, next to a clone of `main`). The
`qa` branch has this package as a dev dependency, so `npx bd` works there.

| Command                                                         | What it does                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bd build [--base main]`                                        | Regenerates every `tickets/<id>/gate1/` (the tests of `main` plus the regression test of every other ticket) and rebuilds each ticket branch as one commit: `main`, the ticket's `bug.patch`, its `gate1/` and its Jira card            |
| `bd verify [ids...]`                                            | Runs the project's QA tool (`npm run qa`) on each ticket branch: with the bug, Gate 1 passes and Gate 2 fails; after `reference.patch`, both pass                                                                                       |
| `bd validate [--base-ref origin/qa] [--offline]`                | The committed `manifest.json` matches the committed tickets, the ticket branches and their tags, the policy and the dependency rules hold, and the version is newer than the one on the base ref; prints one `ok`/`FAIL` line per check |
| `bd validate --remote <owner/repo> [--ref qa] [--project <id>]` | The same checks on what GitHub serves, ticket by ticket through its tag (`<id>-v<version>`), never through the branch tip                                                                                                               |
| `bd publish --version X.Y.Z [--dry-run]`                        | Writes and commits `manifest.json` on the work branch and pushes the ticket branches and the work branch (never `qa`; the merge creates the tags). Run again, it only redoes the pushes                                                 |
| `bd publish --abort --version X.Y.Z`                            | Undoes a publication that was committed but not pushed: the "Publish" commit and the manifest                                                                                                                                           |
| `bd catalog-check [--file projects.json]`                       | Validates the catalog and every listed project (this repository's own check)                                                                                                                                                            |

## Publishing a project

1. In the project's `main` clone, change the app. In the `qa` folder, switch to a work branch
   (`git switch -c publish/2.5.0`) and change the tickets.
2. `npx bd build`, commit the regenerated `gate1/` folders, then `npx bd verify`.
3. `npx bd publish --version 2.5.0`. It writes and commits `manifest.json` and pushes the ticket
   branches and the work branch. It never pushes `qa` and creates no tags: nothing permanent exists
   before the merge. If a push fails, fix the cause and run the same command again: it only redoes
   the pushes. `npx bd publish --abort --version 2.5.0` undoes a publication that was committed but
   not pushed yet (the "Publish" commit and the manifest); after a push, close the pull request and
   publish the next version instead (a closed pull request leaves nothing behind).
   Housekeeping changes on `qa` (README, workflows, `CODEOWNERS`, `.npmrc`) need no new version:
   `bd validate` accepts the same version while `manifest.json` and `tickets/` are exactly the
   published ones, and the merge creates no new tag.
4. Open the pull request into `qa` (the link `bd publish` prints). The project's checks run
   `bd validate` and `bd verify`.
5. Merge. The merge reaches players the next time they take a ticket, and the project's workflow
   tags the publication as `qa-v2.5.0` and each new ticket commit as `<id>-v2.5.0`. Tags are never
   moved or deleted (a ruleset forbids it): the published history stays trustworthy.

The `qa` branch is protected: it changes only through a pull request with green checks, and the
protection must enable "Require branches to be up to date before merging". The version check runs
against `qa` when the checks run, so without it a second pull request with the same version could
keep a stale green check after the first one is merged.

## Project workflows

Each project calls two reusable workflows of this repository.

On `main` (the app), `.github/workflows/ci.yml` runs lint, formatting and the tests on every push
and pull request (`app.yml`). `bd build` keeps `.github/` out of the ticket branches, so players
never get workflows:

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  app:
    uses: bug-detective-project/catalog/.github/workflows/app.yml@v1.2.1
```

On `qa`, `.github/workflows/publication.yml` validates every pull request and tags the merge. Pin
`project.yml` by commit hash with the version in a comment, equal to the `@bug-detective/catalog`
dependency of `qa` (`bd validate` refuses a tag pin or a version that differs from the dependency):

```yaml
name: publication

on:
  pull_request:
    branches: [qa]
  push:
    branches: [qa]

jobs:
  project:
    uses: bug-detective-project/catalog/.github/workflows/project.yml@v1.2.1
    permissions:
      contents: write
```

## Proposing a project

A project of someone outside the organization starts in the author's own repository, with `main`,
`qa` and the ticket branches as any project. The author opens a "New project" issue here (the issue
form asks for the repository, the stack, the skills and the offline rule: no bug needs a new package
and the app calls no external API). A maintainer runs the `validate-remote` workflow (Actions tab,
"Run workflow", with the repository and the branch or tag) which runs `bd validate --remote` through
GitHub's API without cloning or executing anything, then reviews the repository against the pull
request checklist (`.github/pull_request_template.md`: scripts, dependencies, network calls, texts,
`.vscode/`, `.npmrc`, the `Host` check). The repository then moves into the organization with the
author as a writer, and the project enters `projects.json` (first `hidden: true`). From then on the
author publishes with `bd publish` and a pull request into `qa`, merged by a code owner.

## Checks of this repository

- `ci` (push and pull request into `main`): every action pinned by commit hash
  (`tools/check-action-pins.mjs`), typecheck, tests, Prettier, and `dist/` up to date.
- `catalog` (pull request into `main`, every day at 06:00 UTC, and on demand): `bd catalog-check`.
  GitHub disables a scheduled workflow after 60 days without activity in a public repository and
  sends an e-mail; re-enable it in the Actions tab.
- `validate-remote` (on demand): `bd validate --remote` on a proposed project.

Actions are referenced by commit hash with the version in a comment; Dependabot
(`.github/dependabot.yml`) opens a pull request when one has a new release.

GitHub Actions minutes are free for public repositories.

## Development

```sh
npm install
npm run check   # typecheck, tests, Prettier
npm run build   # dist/ (commit it)
```
