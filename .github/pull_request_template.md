<!-- What changes and why. For a new project or a project update, keep the checklist below. -->

## Review checklist (projects)

Every item is a place where published content runs on the player's PC or in their workspace.
`bd validate` checks some of them; the reviewer checks the rest by reading the diff.

- [ ] `package.json` scripts: no new `pre*`/`post*` script, and `allowScripts` only for the allowed packages (`bd validate`)
- [ ] New dependencies: from the npm registry with integrity, at least 7 days old, and needed by the project (`bd validate` checks origin and age; the reviewer checks the need)
- [ ] Network calls in the server: none to the internet; the app works offline
- [ ] Texts (tickets, solutions, reviews, hints, story): no command to run on the PC, only inside the workspace (`bd validate` catches the known patterns)
- [ ] `.vscode/`: only `settings.json`, `extensions.json` and `launch.json`, recommending only allowed extensions (`bd validate`)
- [ ] `.npmrc` on `main` and on every ticket branch: `allow-git=none`, `allow-remote=none`, `min-release-age=7` (`bd validate`)
- [ ] The API checks the `Host` header (only `localhost` and `127.0.0.1`)
