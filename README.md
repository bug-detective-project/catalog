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

The order of the list is the order of the cards on the Projects screen: the starter first, then the
projects from beginner to advanced (`bd catalog-check` refuses a project listed after a higher
level; a project without a `difficulty` keeps the level before it). A project with a ticket whose
type is not `fix` (see [`ticket.json`](#ticketjson)) needs `minAppVersion` 1.1.0 or newer, the first
desktop version that knows ticket types. Names, descriptions, technologies, difficulty and ticket
counts come from each project's `qa` branch. Versions are never
listed here: each project's `manifest.json` has its own.

In a project's `qa` branch, `package.json` holds `bugDetective.project`: `id`, `name`, the optional
`difficulty` (`beginner`, `intermediate` or `advanced`) and the optional `stack`
(`{ "frontend": "React · Vite", "backend": "Node.js · Express", "database": "SQLite" }`, any of the
three, up to 60 characters each). `bd build` and `bd publish` copy them into `manifest.json`. The
texts live in `story.en.json` and `story.pt.json`, including the optional `project.skills`: 1 to 12
skills the player practices, with the same count in every language (`bd validate` checks it). The
project card shows the first 5 and a "see all", so the order is the author's choice.

### `ticket.json`

A ticket may describe itself in `tickets/<id>/ticket.json`; `bd build` and `bd publish` copy the
three fields into the ticket's entry of `manifest.json`:

```json
{
  "type": "build",
  "bothSides": false,
  "skills": { "en": ["Building components"], "pt": ["Criação de componentes"] }
}
```

| Field       | Values                                                                                             | Without it |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------- |
| `type`      | `fix`, `build`, `complete`, `refactor`, `optimize`, `upgrade` or `investigate`                     | `fix`      |
| `bothSides` | `true` when the ticket needs changes in the front end and in the back end (it keeps its one track) | `false`    |
| `skills`    | 1 to 5 skills per language, up to 60 characters each, the same count in `en` and `pt`, none twice  | none       |

The file is optional and takes no other key. The desktop labels the card with the type and the
"Front + back" mark, picks its QA and review texts by type, and shows the skills only once the
ticket is Done, because before that they hint at the cause. Skills are free text here and in
`project.skills`: there is no skills list to import. Write them with the names of the Bug Detective
documentation (the skills section of the product requirements).

Change `projects.json` through a pull request: the `catalog` check validates the file and every
listed project before the merge.

### Project services

A project whose code needs a database declares it in `bugDetective.project.services` of the
`package.json` on `qa`; `bd` copies the declaration into the manifest:

```json
"services": {
  "db": {
    "image": "postgres:17",
    "memory": "256m",
    "env": { "POSTGRES_PASSWORD": "shop", "POSTGRES_DB": "shop" },
    "variables": { "DATABASE_URL": "postgres://postgres:shop@{{host}}:{{port}}/shop" }
  }
}
```

- `image` is a name from the list of allowed images (`SERVICE_IMAGES` in `src/contract/services.ts`),
  today `postgres:17`, `mysql:8.4` (whose default server needs `512m`) and `redis:8` (which runs
  in `128m`). The list pins each image by digest and knows its port, its unprivileged user, its
  data paths, the command that tells when it is ready and its server program. A new image enters
  by pull request to this repository.
- `memory` is the container's limit, from `64m` to `1g` (default `256m`), written as a whole number
  followed by `k`, `m` or `g`.
- `env` is the environment of the service's own container.
- `variables` is what the project's code reads. Whoever starts the service fills `{{host}}` and
  `{{port}}`: the app with the service name on the project's internal network, `bd verify` with
  `127.0.0.1` and a free port. The code, the QA tool and `db:reset` must read these variables and
  never a fixed address. A name is upper-case, may not start with `BUGDETECTIVE_` and may not be
  `PATH`, `HOME`, `NODE_OPTIONS`, `NODE_PATH`, `SHELL`, `USER` or `PWD`; two services may not define
  the same one.
- `args` (optional) is the list of arguments of the server: a password, a memory limit, a setting.
  The service then runs the image's server program (`postgres`, `mysqld` or `redis-server`, which
  the project does not choose) followed by them, each exactly as written, with no shell in
  between. Without `args` the image runs as it is. The rules: at most 24 arguments of up to 200
  characters each, with no line breaks; the first one is an option (it starts with `-`); and none
  sets what the app controls, the port, the data folder, the listening address or the user
  (`reservedOptions` of each image in `src/contract/services.ts`), in any spelling: `--port=7000`,
  `-c port=5433` and `-P3307` are all refused. An empty argument is allowed after the first one
  (Redis turns its snapshots off with `--save ""`). For example, the Redis image reads no password
  from the environment, so a project gives it as an argument, with a memory limit that keeps a
  full cache from being killed:

  ```json
  "cache": {
    "image": "redis:8",
    "memory": "128m",
    "args": ["--requirepass", "shop", "--maxmemory", "96mb", "--maxmemory-policy", "allkeys-lru"],
    "variables": { "REDIS_URL": "redis://default:shop@{{host}}:{{port}}" }
  }
  ```

  The address names the user, `default`: the `redis-cli` of the app's workspace (7.0) sends an
  empty user name for `redis://:shop@…` and the server refuses it, while other clients accept both.

- `publish: true` (optional) asks the app to also publish the service's port on the player's
  computer, on `127.0.0.1` only and on a free port, for the player's own database tools. The
  project's code never uses that port.
- A service name is lower-case letters, digits and `-`, up to 20 characters; a project has at most
  4 services.
- `bugDetective.project.memory.workspace` asks for a larger workspace, from `1g` to `4g` (default
  `3g`).
- The memory peak may not pass 8 GB: the workspace, the services, a QA run (2 GB) and the services
  of that run, all at the same time. The example above needs 5.5 GB.

`bd validate` refuses a declaration outside these rules, naming the field. `bd verify` needs Docker
for such a project: before every QA run it starts each service with its data in memory, without
privileges and published on `127.0.0.1` only, passes the variables to `npm run qa`, and removes the
containers afterwards, also when the run fails or is interrupted. Containers a crashed run left
behind are removed by the next one. A service whose arguments its server refuses stops at once,
and the error carries the end of its log. A catalog project that declares services needs
`minAppVersion` 1.2.0 or newer; one that uses `mysql:8.4` needs 1.3.0 or newer; and one that uses
`redis:8` or gives a service `args`, even an empty list, needs 1.4.0 or newer. An older app does
not know the image or the field and refuses the project's manifest, so `bd catalog-check` refuses
the catalog entry first (`minAppVersion` of each image in `SERVICE_IMAGES`).

### Project ports

Without a declaration, the desktop publishes two ports of the workspace on the player's computer:
the client (5173) and the API (3001). A project whose code listens on other ports, such as one with
two services that talk to each other, declares them in `bugDetective.project.ports` of the
`package.json` on `qa`; `bd` copies the declaration into the manifest:

```json
"ports": {
  "client": {
    "port": 5173,
    "open": true,
    "label": { "en": "Smoke Desk", "pt": "Smoke Desk" },
    "variables": { "CLIENT_ORIGIN": "http://localhost:{{port}}" }
  },
  "api": { "port": 3001 },
  "audit": {
    "port": 3002,
    "label": { "en": "Audit service", "pt": "Serviço de auditoria" },
    "variables": { "VITE_AUDIT_URL": "http://localhost:{{port}}" }
  }
}
```

- `port` is the port the process listens on inside the workspace, from 1024 to 55535, each once.
  The desktop publishes it on `127.0.0.1` on a free port of the computer, the same number when it
  is free, and whether the process listens on `localhost` or on `0.0.0.0`.
- `client` is required: it is the port "Open app in browser" opens. `open: true` gives another
  port its own button on the Dashboard, and `label` the name shown there (the port's name without
  it).
- `variables` are what the code reads, with `{{port}}` filled with the port chosen on the computer.
  Their names follow the rules of the services' variables and repeat no variable of a service or of
  another port.
- A port name is lower-case letters, digits and `-`, up to 20 characters; a project has at most 6
  ports.
- In QA nothing is published: the project's QA CLI picks a free port for each process and fills the
  same variables with `portVariables(ports, chosen)` from the contract.

A catalog project that declares ports needs `minAppVersion` 1.3.0 or newer.

## The contract (`@bug-detective/catalog/contract`)

Schemas and checks shared by the desktop app and `bd`: the catalog, the project manifest
(`formatVersion`, currently 1; a newer one raises `UnsupportedFormatError`, which the app shows as
"update Bug Detective"), the story, `review.json`, a project's services (`services.ts`) and ports
(`ports.ts`, with `portVariables`), archive digests, the verification of a ticket
package and its code against the manifest, and the archive path rules: besides `..`, absolute paths
and drive letters, a file name Windows cannot store (`:`, `< > " | ? *`, reserved device names such
as `CON` or `aux.ts`, a trailing dot or space) or two paths that differ only by case are refused,
because players extract the packages on their disk.

It also holds the project policy (`policy.ts`), applied by `bd validate` to every publication:
the VS Code extensions a project may recommend (`ALLOWED_VSCODE_EXTENSIONS`: ESLint, Prettier,
Vitest and, for looking at the data of a project's services, SQLTools with its PostgreSQL and MySQL drivers; UI extensions run on the player's PC, outside the workspace), the files allowed in
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
  dependencies). A package bundled inside another one (`inBundle` in the lockfile, as in Tailwind's
  `@tailwindcss/oxide-wasm32-wasi`) has neither of its own: the hash of the package that carries it
  covers it;
- `package.json` may allow install scripts (npm's `allowScripts`) only for the packages of
  `ALLOWED_INSTALL_SCRIPTS` (`better-sqlite3` today); other packages with scripts are fine, npm
  does not run them;
- every version has been on the registry for at least 7 days (`min-release-age`), read from the
  registry's `time` field; `--offline` skips this check;
- `.npmrc` on `main` and on every ticket branch sets `allow-git=none`, `allow-remote=none` and
  `min-release-age=7`, so the same rules protect the author's own `npm install`. One known
  exception when **creating** a lockfile: npm refuses to resolve a package with bundled
  dependencies under `allow-remote=none` (`EALLOWREMOTE`). Run that one `npm install` with
  `--allow-remote=all` and let `bd validate` check the lockfile it writes; `npm ci` from the
  lockfile needs no flag.

`npm audit` is not part of `bd validate`: it runs as a non-blocking step of the project's `main` CI.

## `bd`

Run inside a project's `qa` folder (a worktree of its `qa` branch, next to a clone of `main`). The
`qa` branch has this package as a dev dependency, so `npx bd` works there.

| Command                                                         | What it does                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bd build [--base main]`                                        | Regenerates every `tickets/<id>/gate1/` (the tests of `main` plus the regression test of every other ticket) and rebuilds each ticket branch as one commit: `main`, the ticket's `bug.patch`, its `gate1/` and its Jira card                                                                      |
| `bd verify [ids...]`                                            | Runs the project's QA tool (`npm run qa`) on each ticket branch: with the bug, Gate 1 passes and Gate 2 fails; after `reference.patch`, both pass. A project with [services](#project-services) gets them started before each run and removed after it (needs Docker)                             |
| `bd validate [--base-ref origin/qa] [--offline]`                | The committed `manifest.json` matches the committed tickets, the ticket branches and their tags, the policy and the dependency rules hold, and the version is newer than the one on the base ref; prints one `ok`/`FAIL` line per check                                                           |
| `bd validate --remote <owner/repo> [--ref qa] [--project <id>]` | The same checks on what GitHub serves, ticket by ticket through its tag (`<id>-v<version>`), never through the branch tip                                                                                                                                                                         |
| `bd publish --version X.Y.Z [--dry-run]`                        | Writes and commits `manifest.json` on the work branch and pushes the ticket branches and the work branch (never `qa`; the merge creates the tags). Run again, it only redoes the pushes                                                                                                           |
| `bd publish --abort --version X.Y.Z`                            | Undoes a publication that was committed but not pushed: the "Publish" commit and the manifest                                                                                                                                                                                                     |
| `bd catalog-check [--file projects.json]`                       | Validates the catalog and every listed project, the order of the cards by level and the `minAppVersion` of projects with other ticket types or with services (this repository's own check)                                                                                                        |
| `bd with-services --file <json> [--project <id>] -- <command…>` | Starts the services of a JSON file shaped like `bugDetective.project.services`, runs the command with their variables (`DATABASE_URL`…) pointing at `127.0.0.1`, removes the services and exits with the command's code. Works in any folder; the CI of a project's `main` uses it for `npm test` |

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

A project whose tests need its services (a database) keeps on `main` a JSON file with the same
content as `bugDetective.project.services` of its `qa` branch, and passes it to the workflow with
the commit it pins. `npm test` then runs through `bd with-services`: each service starts in a
container, hardened as in `bd verify`, with its variables pointing at `127.0.0.1`, and is removed
afterwards:

```yaml
jobs:
  app:
    uses: bug-detective-project/catalog/.github/workflows/app.yml@<commit hash> # v1.6.0
    with:
      services-file: services.json
      catalog-ref: <the same commit hash>
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
npm run check   # typecheck, action pins, tests, Prettier (the CI runs check:ci: the tests already check the pins)
npm run build   # dist/ (commit it)
```
