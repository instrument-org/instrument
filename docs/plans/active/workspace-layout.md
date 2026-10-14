# Plan: the workspace is a folder you pick; this machine keeps the rest

Status: in progress on branch `workspace-layout`. Nothing merges to main until it has been reviewed.

A chat's folder today is two things at once: the agent's working directory (its files, uploads, downloads, `.venv`, `node_modules`, copied skills, its tasks' work) and the home of the app's records for that chat (`.instrument/chat.db`, `settings.json`), which every layer then has to hide from the agent. The workspace mixes portable data (chats, drafts, topics, skills) with things that only make sense on one computer (encrypted keys, browser cookies, window state, tool caches). Most of the folder-management code in the repo exists to keep those mixtures from leaking: masking, the package template copied into every chat, the "your folder is a package root" rule, the venv pinned to the chat, skills copied into the chat.

Every other agent product keeps conversation records apart from where the agent works, reads skills in place, and works at real paths. This plan does the same, and in doing so makes the workspace a single folder a person picks, could back up, and could later sync.

Related: [choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md) (the onboarding step that picks the folder; this plan makes that folder the workspace, and leaves the step itself to that plan), [skills-mount-instead-of-copy.md](skills-mount-instead-of-copy.md) (its remaining step, removing the copy, is done here), [chat-attachments-by-reference.md](chat-attachments-by-reference.md) and [conversation-storage.md](conversation-storage.md) (independent; not changed here).

## Words

| Concept | In code | In the app |
|---|---|---|
| The folder the person picks, holding everything that follows them | workspace: `workspaceDir` (was `rootDir`), `WorkspaceConfig`, `stores/workspace`, `workspaces.json` | "your Instrument folder" |
| The app's part of that folder | `workspaceDataDir`: `<workspace>/.instrument/` | never shown |
| This computer's data | machine: `machineDir` (Electron's userData), `stores/machine` | never shown |
| What can always be rebuilt | `runtimeDir`: `<machine>/runtime/` | never shown |
| A chat's working directory | `workDir(chatId)`: `<machine>/workspaces/<workspace id>/work/<chat id>/` | the chat's files |

No "vault" anywhere. `packages/workspace` keeps its name for now; renaming it (to `agent`) is a separate, mechanical change.

## Layout

```
<the folder you picked>/                       THE WORKSPACE (default ~/Documents/Instrument)
  <finished work, one folder per job>/         INSTRUMENT_OUTPUT points here
  .instrument/                                 hidden (dot on macOS and Linux, hidden attribute on Windows)
    workspace.json                             id, name, color, format version, migration markers
    preferences.json                           what follows the person: default model, theme, …
    chats/<id>/
      chat.db                                  the conversation, its tasks' sessions included
      settings.json                            model, grants, where the person left off
      attachments/                             what the person sent; read in place, never copied
    drafts/<id>/  topics/<Name>/  memory/
    skills/<name>/                             the workspace's own skills (the agent reads and writes them)
    apps/<slug>/                               connected apps' setup, no secrets

~/Library/Application Support/Instrument/       THIS MACHINE (~/.config/Instrument, %APPDATA%\Instrument)
  workspaces.json                              each workspace's id and where its folder is
  machine preferences, updater state
  runtime/                                     shared by every workspace, rebuildable
    bin/                                       git, node, pnpm, rg, uv on PATH
    python/                                    the managed interpreter, read-only to chats
    caches/                                    uv and its tools, the pnpm store, npm, model downloads
    config/                                    where programs keep their settings
    skills/<name>/                             the skills the app ships, read-only
    sandbox/                                   bubblewrap's stand-in for a closed file
    environments/<lockfile hash>/              one per skill dependency set, read-only
  workspaces/<workspace id>/                   this machine's data for one workspace
    keys/                                      provider keys, app sign-ins, ChatGPT and Claude accounts
    browser/                                   app and in-app browser sessions, history
    permissions.json                           folder rules (paths are this machine's)
    window/                                    window and layout state
    index/                                     search index
    work/<chat id>/                            each chat's work folder
  (Chromium's own Cache, Cookies, GPUCache, … as today)
```

`workspace.json` is read first on every launch and changes almost never; an app whose format version is older than the workspace's refuses to open it and says to update. `preferences.json` changes whenever a setting does, so it stays a separate file.

## What the agent sees

Real paths everywhere; Windows spells `C:\` as `/c/`, Git Bash's convention, and nothing else is respelled.

- Every command starts in the chat's work folder. It is made on the chat's first command, reaped when still empty, and made again, empty, after being cleared. Tasks share it; the agent makes a subfolder per job.
- `INSTRUMENT_WORK`, `INSTRUMENT_ATTACHMENTS`, `INSTRUMENT_OUTPUT`, `INSTRUMENT_SKILL_DIR` name the places it needs; the shell sets them and every program it starts sees them.
- `$TMPDIR` is the system's temp folder, shared, for throwaway files.
- A skill is read where it is; `load_skill` gives its folder. `python <skill>/scripts/x.py` runs with that skill's environment, chosen by where the script is. Elsewhere `python` and `pip` use the nearest `.venv` up to the work folder's root, made by the first `pip install`; `pnpm add` makes its own `package.json`. Our tools come first on PATH, their caches and safety settings (the one-week release gate) live in `runtime/`.
- A file the agent delivers goes in `INSTRUMENT_OUTPUT/<job>/`, or where the person said.

## What the sandboxes allow

One rule set feeds the shell's own checks and the Seatbelt and bubblewrap profiles. Inside the machine folder and the workspace's `.instrument/`, everything starts closed; the deepest rule wins, and only these open:

| Path | Access |
|---|---|
| its own `work/<chat id>/` | read and write |
| its own `chats/<id>/attachments/` | read |
| `.instrument/skills/`, `.instrument/apps/` | read and write |
| `runtime/caches/`, `runtime/config/` | read and write |
| `runtime/python/`, `runtime/skills/`, `runtime/environments/`, `runtime/bin/` | read |

Everything else there (other chats, their work folders, `chat.db`, `settings.json`, `workspace.json`, `preferences.json`, keys, browser data, `permissions.json`) is refused plainly, not hidden. The folders above an open one can be passed through but not listed. The workspace's top level (finished work) and everything else on the computer follow the person's rules in Settings › Permissions.

## Phases

Each phase ends with types, lint and the related tests green, and is committed on the branch before the next starts.

1. **`runtime/`.** Move the managed Python, uv and node-tools caches and config, the `bin/` links and the prepared skills under `runtime/`, laid out by `runtimeLayout` from one `runtimeDir` in the config. Old copies are deleted on boot; they are rebuilt on use, and a chat's `.venv` made from the old interpreter is made again on its next Python command. `bin/` gains `uv` but no `python`: the shell's `python` is the chat's `.venv`, which every native command it starts has ahead of `bin/` (a script `pnpm` runs aside); the managed interpreter is installed on first use, after `bin/` is made; and a `python` in `bin/` would also stand in for the person's own in every program the app starts. Phase 4 decides it with the venv that follows the folder.
2. **Machine data per workspace.** Studio's workspace stores split: secrets (provider configs, app credentials and OAuth, ChatGPT account and plan), browser sessions and history, window and layout state, downloads, connection state and permissions move to `workspaces/<workspace id>/`; what follows the person stays in the workspace. Marker dotfiles fold into `workspace.json`.
3. **Records apart from work.** `chats/<id>/` holds `chat.db`, `settings.json` and `attachments/` only (no `.instrument/` inside it, no `tasks/`, no template). `workDir(chatId)` moves to the machine. Existing chats migrate: their old folder's working contents move to the new work folder, so relative links keep resolving against it, with the record folder as the fallback for `attachments/`. Masking, the per-chat package template, and `tasks/` handling are deleted.
4. **The agent's environment.** The variables, the prompt's folder section rewritten, `.venv` and `node_modules` that follow the folder, the pnpm package-root guard removed, the sandbox rule set above.
5. **Skills in place.** `load_skill` stops copying; one environment per skill lockfile hash, built by the app in `runtime/environments/`; Python picks it by the script's location. Node skills need their files beside `node_modules`, so a Node skill's environment holds one built copy per skill version, shared by every chat.
6. **The workspace is the folder you pick.** `workspaces.json` records where each workspace lives (default `~/Documents/Instrument`, one constant); the data moves there from the machine folder; `.instrument/` is hidden on Windows; the format version is checked on launch; paths inside the workspace are stored relative to it when a message is saved, and resolved against it when read. The 1.x migration ends the same way. The onboarding step that lets the person pick the folder belongs to [choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md).
7. **Proof.** A seeded workspace migrates cleanly. Preview builds run the scenarios as real agent turns on a fresh macOS VM, then Windows, then Linux, with the sandbox checks.

## Migration

Every install ends in the same shape: the 1.x migration (kept: 1.x users exist), then the beta layout, then this. Formats that only ever existed in the 2.0 private beta may break rather than carry a shim. If the plan is abandoned, the moves are reversible: each is a rename recorded in the migration code.

## Not in this plan

- Stable provider identity for a chosen model, so a chat's model matches on another computer (progressive matching).
- A lock file so two computers don't run the same chat at once; a recovery screen when the workspace folder is missing.
- The conversation as an append-only log (needed before the workspace is safe in iCloud on two computers at once).
- Syncing Claude subscription sessions; a phone app reading the workspace.
- Two workspaces open in one app process (the layout allows it; the process model doesn't yet).
