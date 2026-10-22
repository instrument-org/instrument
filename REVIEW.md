# Review instructions

How to calibrate a review of this repo, whether of a pull request, a branch, or the last few days of commits. Correctness and user impact come first; the rest of this file only tunes what gets flagged and how.

## What counts as Important

A concrete defect that should be fixed before it ships: a correctness bug, a security hole, a regression. These areas deserve the most attention here:

- **Security.** Judge a finding against [`docs/architecture/threat-model.md`](docs/architecture/threat-model.md). One that crosses a line it protects is Important; one its "Do not fix" list names is not reported.
- **Containment.** Anything that lets the agent reach further than Settings › Permissions allows, at any layer: the in-process rules the shell and file tools follow, the operating system's sandbox around the programs it starts, and what the app runs outside the sandbox on the agent's behalf. Narrowing is fine; widening is Important.
- **The person's data.** A change must not lose, overwrite, or strand what a workspace keeps: a chat's records and its work folder, the person's own folders at the workspace's top level, this computer's files in the workspace's machine folder, and what earlier builds left for the migrations to read. A changed stored shape still reads what the previous release wrote, or ships a migration. The root `CLAUDE.md` describes the layout.
- **Privacy.** Prompts, messages, file contents, paths, keys, and `.env` values must not reach telemetry, logs, or a network destination they were not meant for.
- **Agent turns.** Deterministic tool, prompt, message-assembly, or state defects that make a turn fail, hang, or silently drop state.
- **Studio's privilege boundary.** The renderer reaches Electron, Node, and the remote API only through the preload API and main-process RPC. No lint rule catches a direct import.
- **Packaging.** A change that works under `pnpm dev` but breaks or bloats the packaged app, such as a dependency in the wrong list or a native binary left inside the asar.

Naming, structure, refactors, prose, and test layout are Nits at most.

## Do not report

- What `pnpm check-and-test` already enforces: formatting, lint, types, spelling, unused code, the lockfile, and its other checks.
- Anything in `registry/`, generated files, and version bumps in release commits.
- A tradeoff a record in `docs/decisions/` already accepts.
- A what-if outside the threat model, such as the agent writing a file (or planting a link) that a later agent or the app then reads, and speculative performance worries with no measured cost. Report what breaks on given inputs, or a design flaw that will cost a migration later.
- Documentation style or completeness. A doc claim the code contradicts is worth reporting.
- General requests for more tests. Name a missing test only when the behavior matters and an existing test project could observe it.

## Evidence and shape

- Cite `file:line` for each claim about behavior and give the concrete scenario where it goes wrong. Docs describe intent, so trace the code before reporting.
- A static trace that proves the path is enough. Leave out what reading cannot settle rather than building a reproduction for every hunch, and say which findings were confirmed by running something.
- Report the root cause once, not once per call site.
- Keep it to five Nits; mention the rest as "plus N similar".
- On a second pass over the same work, raise only new Important findings and Nits in code added since.
- Past reviews and what came of each finding are in [`docs/reviews/`](docs/reviews/README.md). A finding that reverses a declined one there, a `Rejected:` or `Commits-to:` trailer on the lines it cites, or a record in `docs/decisions/` names that record and says why its reason no longer holds.
