# Plan: the workspace is a folder you pick; this machine keeps the rest

Status: built and landed. Every phase below says what it built; what is left of this plan is phase 6's relative paths, and a workspace folder the person moves by hand carrying the window's tabs and the recent files with it.

A chat's folder today is two things at once: the agent's working directory (its files, uploads, downloads, `.venv`, `node_modules`, copied skills, its tasks' work) and the home of the app's records for that chat (`.instrument/chat.db`, `settings.json`), which every layer then has to hide from the agent. The workspace mixes portable data (chats, drafts, topics, skills) with things that only make sense on one computer (encrypted keys, browser cookies, window state, tool caches). Most of the folder-management code in the repo exists to keep those mixtures from leaking: masking, the package template copied into every chat, the "your folder is a package root" rule, the venv pinned to the chat, skills copied into the chat.

Every other agent product keeps conversation records apart from where the agent works, reads skills in place, and works at real paths. This plan does the same, and in doing so makes the workspace a single folder a person picks, could back up, and could later sync.

Related: [choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md) (the onboarding step that picks the folder; this plan makes that folder the workspace, and leaves the step itself to that plan), [skills-mount-instead-of-copy.md](../completed/skills-mount-instead-of-copy.md) (its remaining step, removing the copy, was done here), [chat-attachments-by-reference.md](chat-attachments-by-reference.md) and [conversation-storage.md](conversation-storage.md) (independent; not changed here).

## Words

| Concept | In code | In the app |
|---|---|---|
| The folder the person picks, holding everything that follows them | workspace: `workspaceDir` (was `rootDir`), `WorkspaceConfig`, `stores/workspace`, `workspaces.json` | "your Instrument folder" |
| The app's part of that folder | `workspaceDataDir`: `<workspace>/.instrument/` | never shown |
| This computer's data | `userDataDir` (Electron's userData), `stores/machine` | never shown |
| What can always be rebuilt | `runtimeDir`: `<machine>/runtime/` | never shown |
| This computer's data for one workspace | `workspaceMachineDir`: `<userData>/machine/<local id>/` | never shown |
| A chat's working directory | `workDir(chatId)`: `<userData>/machine/<local id>/work/<chat id>/` | the chat's files |

No "vault" anywhere. `packages/workspace` keeps its name for now; renaming it (to `agent`) is a separate, mechanical change.

## Layout

```
<the folder you picked>/                       THE WORKSPACE (<userData>/workspace until picked; the picker suggests ~/Documents/Instrument)
  <finished work, one folder per job>/         INSTRUMENT_OUTPUT points here
  .instrument/                                 hidden (dot on macOS and Linux, hidden attribute on Windows)
    workspace.json                             id, name, color, format version, migration markers
    preferences.json                           what follows the person: default model, theme, …
    features.json  bookmarks.json              the person's flags and bookmarks
    chats/<id>/
      chat.db                                  the conversation, its tasks' sessions included
      settings.json                            model, grants, where the person left off
      attachments/                             what the person sent; read in place, never copied
      handoff-notes.md                         the agent's notes for when its context runs out, the one file here it writes
    drafts/<id>/  topics/<Name>/  memory/
    skills/<name>/                             the workspace's own skills (the agent reads and writes them)
    apps/<slug>/                               connected apps' setup, no secrets

~/Library/Application Support/Instrument/       THIS MACHINE (~/.config/Instrument, %APPDATA%\Instrument)
  workspaces.json                              each workspace's local id, its own id, and where its folder is
  machine preferences, updater state
  runtime/                                     shared by every workspace, rebuildable
    bin/                                       git, node, pnpm, rg, uv on PATH
    python/                                    the managed interpreter, read-only to chats
    caches/                                    a chat's uv and its tools, the pnpm store, npm, model downloads
    config/                                    where a chat's programs keep their settings
    build/caches/  build/config/               the same for what the app builds or loads, closed to chats
    preload/                                   what the app loads into a chat's programs, read-only to chats
    skills/<name>/                             the skills the app ships, read-only
    sandbox/                                   bubblewrap's stand-in for a closed file
    environments/<lockfile hash>/              one per skill dependency set, read-only
  machine/<local id>/                          this machine's data for one workspace
    keys/                                      provider keys, the account sign-in, ChatGPT accounts, app credentials and connections
    browser/                                   app and in-app browser sessions, history, page pictures, downloads
    permissions.json                           folder rules (paths are this machine's)
    window/                                    window and layout state
    index/                                     search index
    app-servers/                               connected apps' local servers, as installed
    state.json                                 whether this machine's providers are set up
    work/<chat id>/                            each chat's work folder
  (Chromium's own Cache, Cookies, GPUCache, … as today)
```

`workspace.json` is read first on every launch and changes almost never; an app whose format version is older than the workspace's refuses to open it and says to update. `preferences.json` changes whenever a setting does, so it stays a separate file.

## What the agent sees

Real paths everywhere; Windows spells `C:\` as `/c/`, Git Bash's convention, and nothing else is respelled.

- Every command starts in the chat's work folder. It is made on the chat's first command, removed when the chat and its tasks come to rest with it still empty (nothing in it but a `.DS_Store` at most), or when the workspace next starts if the app quit before then, and made again, empty, by the next command after that or after being cleared. Tasks share it; the agent makes a subfolder per job.
- `INSTRUMENT_WORK`, `INSTRUMENT_ATTACHMENTS`, `INSTRUMENT_OUTPUT`, `INSTRUMENT_SKILL_DIR` name the places it needs; the shell sets them and every program it starts sees them.
- `$TMPDIR` is the system's temp folder, shared, for throwaway files.
- A skill is read where it is; `load_skill` gives its folder. `python <skill>/scripts/x.py` runs with that skill's environment, chosen by where the script is. Elsewhere `python` and `pip` use the nearest `.venv` up to the work folder's root, made by the first `pip install`, and with none near, `python` runs in the environment of the skill loaded last; the skill's environment and the `.venv` are layered, so a skill's script also finds what `pip install` put in the `.venv`, and the agent's own code the packages of the skill loaded last; `pnpm add` makes its own `package.json`. Our tools come first on PATH, their caches and safety settings (the one-week release gate) live in `runtime/`.
- A file the agent delivers goes in `INSTRUMENT_OUTPUT/<job>/`, or where the person said.

## What the sandboxes allow

One rule set feeds the shell's own checks and the Seatbelt and bubblewrap profiles. Inside the machine folder and the workspace's `.instrument/`, everything starts closed; the deepest rule wins, and only these open:

| Path | Access |
|---|---|
| its own `work/<chat id>/` | read and write |
| its own `chats/<id>/attachments/` | read |
| `.instrument/skills/`, `.instrument/apps/` | read and write |
| `runtime/caches/`, `runtime/config/` | read and write |
| `runtime/python/`, `runtime/skills/`, `runtime/environments/`, `runtime/preload/`, `runtime/bin/` | read |
| `runtime/build/` | none; a build the app runs for the chat reads and writes `build/caches/` and reads `build/config/` |

Everything else there (other chats, their work folders, `chat.db`, `settings.json`, `workspace.json`, `preferences.json`, keys, browser data, `permissions.json`) is refused plainly, not hidden. The folders above an open one can be passed through but not listed. The workspace's top level (finished work) and everything else on the computer follow the person's rules in Settings › Permissions.

## Phases

Each phase ends with types, lint and the related tests green, and is committed on the branch before the next starts.

1. **`runtime/`.** Move the managed Python, uv and node-tools caches and config, the `bin/` links and the prepared skills under `runtime/`, laid out by `runtimeLayout` from one `runtimeDir` in the config. Old copies are deleted on boot; they are rebuilt on use, and a chat's `.venv` made from the old interpreter is made again on its next Python command. `bin/` gains `uv` but no `python`: the shell's `python` is the chat's `.venv`, which every native command it starts has ahead of `bin/` (a script `pnpm` runs aside); the managed interpreter is installed on first use, after `bin/` is made; and a `python` in `bin/` would also stand in for the person's own in every program the app starts. Phase 4 decides it with the venv that follows the folder.
2. **Machine data per workspace.** Studio's workspace stores split: secrets (provider configs, app credentials and OAuth, ChatGPT account and plan), browser sessions and history, window and layout state, downloads, connection state and permissions move to `machine/<local id>/`; what follows the person stays in the workspace. Marker dotfiles fold into `workspace.json`. The folder is not `workspaces/`, which already holds whole workspaces made from the dev panel: one name for two kinds of folder would let a listing or a delete take the wrong one. It is named by the registry's short local id (`default`) rather than the workspace's own id, a ULID minted on first open into `workspace.json` and recorded in the registry entry, because a Chromium profile's deepest paths come close to Windows' 260 characters. The Claude account stays machine-wide, as it was; the window's own record folder (`.instrument/window/`) moves with the other records in phase 3.
3. **Records apart from work.** Done. `chats/<id>/` holds `chat.db`, `settings.json`, `attachments/` and `handoff-notes.md` only (no `.instrument/` inside it, no `tasks/`, no template); the window's `.instrument/window/` likewise. `workDir(chatId)` is `work/<id>/` in the machine folder (`workFoldersDir` in the config), made by the chat's first command. Existing chats migrate in the layout sweep (layout version 5, after the 1.x migration, `split-chat-records.ts`): their records move up out of `.instrument/`, their old folder's working contents move to the new work folder, so relative links keep resolving against it, with the record folder as the fallback for `attachments/`; `.venv`, `node_modules` and `.tmp` are dropped rather than moved, since they hold absolute paths and are made again; an old `tasks/` folder moves too, its tasks' records set aside under `.pre-chats/`. The sweep writes a stored absolute path into an old chat folder where it went (`rewriteStoredPaths`: the folder rules, a draft's attachments, the window's tabs and recent files); phase 6 adds the workspace's own move there. Masking and `tasks/` handling are deleted.
4. **The agent's environment.** Done. The shell sets `INSTRUMENT_WORK`, `INSTRUMENT_ATTACHMENTS` and `INSTRUMENT_OUTPUT` (`FOLDER_VARIABLES`), and every native command it starts gets them in the host's spelling; the prompt's folder section says where things go by those names: commands start in the work folder, a folder per job, what the person sent read where it is, finished work in the output folder in a folder for the job or where the person said, `$TMPDIR` for throwaway files. Nothing is scaffolded into the work folder: no template and no `work/` inside it (a loaded skill's copy is under `skills/` until phase 5, screenshots under `screenshots/`). The template's pnpm settings that hold anywhere (the one-week release gate, unapproved build scripts skipped, no install started by `run` or `exec`, `pnpx`'s cache kept 180 days, no update check) are `pnpm_config_*` in `nodeToolsEnvFor`; `allowBuilds` cannot be set machine-wide, and the note after skipped builds says to run `pnpm approve-builds <name>` where they were installed. The package-root guard is gone, so `pnpm add` in a folder with no `package.json` makes one there. `python`, `pip`, `uv pip` and the PATH use the nearest `.venv` up to the work folder's root; with none, `python` runs the managed interpreter itself and the first `pip install` makes `$INSTRUMENT_WORK/.venv`; `bin/` gets no `python`. The rule set above is `appData` rules in `layoutRules`, over this computer's folder (`userDataDir`, new in the config), the workspace's machine folder, the runtime folder and the workspace (which stands for `.instrument/` until phase 6 moves the workspace), fed to the shell's checks, the file tools and both native profiles: refused plainly, with no card; a person's rule inside it dropped and one on a folder holding it outranked; a card for something beside it naming the folder below the one that holds it, or none. The `hidden` level is gone. `runtime/environments/` is opened ahead of phase 5, which fills it.
5. **Skills in place.** Done. `load_skill` copies nothing into the work folder: it names the folder a skill is read and its scripts run from (`skillDir` in its result), and the shell sets `INSTRUMENT_SKILL_DIR` to the one the session loaded last, for every program it starts too, read back from the session's history (`lastLoadedSkillDir`; a task's is its chat's up to the fork until it loads its own). A skill the app ships is read from `runtime/skills/<name>/`, the workspace's own from `.instrument/skills/<name>/`, another agent's where it was found.

   The app builds each skill's dependencies in `runtime/environments/<hash>/` (`skill-environments.ts`), read-only to chats and shared by every one of them, held to the asking chat's reach with only the folder being built opened to it, in a folder beside it renamed into place when whole. A Python skill gets one relocatable virtualenv per `uv.lock`, named by its hash and the managed Python's version, bytecode compiled, and built again when its Python is gone. A Node skill (barcodes, markdown, sharp-images, spreadsheet and zip among those the app ships) gets one built copy of the skill per version, named by its package fingerprint, with its production packages beside its scripts, and `load_skill` names that copy; a Python script in it still runs in the skill's Python environment. A third-party skill gets neither. Environments are built on a skill's first load (or its first script, where one is missing) rather than when the app prepares the skills it ships, because a first launch would otherwise fetch every skill's packages at once, competing with the first turn for the one skill it needs: the pdf skill's environment takes about 2 seconds with an empty uv cache and half a second with a warm one, and nothing once built.

   `python` runs a script in a skill's folder (`runtime/skills/`, a Node skill's copy, the workspace's skills) in that skill's environment; anything else in the nearest `.venv`, or with none near, in the environment of the skill loaded last, so the agent's own code against a skill's packages runs without installing them again. `uv run --project <skill>` runs in the same environment as it stands (`UV_PROJECT_ENVIRONMENT`, `UV_NO_SYNC`). The two are layered (`pythonLayerEnv`), so a package a skill's instructions say to `pip install` (local-ml's extras) reaches its scripts, and the skill's packages reach the agent's own code once it has a `.venv`: a skill's script, and `uv run --project <skill>`, get the nearest `.venv`'s site-packages after the environment's own, and anything else run in a `.venv` gets those of the skill loaded last after the `.venv`'s, so the skill's pinned versions win in its scripts and the agent's own installs in its code. The layer is a `sitecustomize` the app writes to its own folder in `environments/`, first on `PYTHONPATH`, which `site` imports once the interpreter's site-packages are on `sys.path`; it appends the folder `INSTRUMENT_EXTRA_SITE_PACKAGES` names with `site.addsitedir`, `.pth` files and all, where a `PYTHONPATH` entry would go ahead of them, only in a Python of the managed version, and then runs any `sitecustomize` it stands in front of. A Python those start inherits both variables and so the same layering; `pip install` still makes and fills `$INSTRUMENT_WORK/.venv`, never an environment. Another program the shell starts (a `node` script, say) that runs `python` itself still finds the nearest `.venv` on its PATH; nothing stands in for `python` there, and no layer is added. The chat split (layout version 5) drops the copies of the app's own skills that earlier builds made in a chat's folder (`skills/instrument/<name>/` and `skills/system/<name>/`, under `work/` in older ones) rather than moving them. Built copies and environments no skill uses any more stay in `runtime/environments/` until that folder is cleared.
6. **The workspace is the folder you pick.** `workspaces.json` records where each workspace lives (setup's first step places it; earlier builds started it in the app's own data; the picker suggests `~/Documents/Instrument`, one constant); the data moves there from the machine folder when the person picks it; `.instrument/` is hidden on Windows; the format version is checked on launch; paths inside the workspace are stored relative to it when a message is saved, and resolved against it when read. The 1.x migration ends the same way. The onboarding step that lets the person pick the folder belongs to [choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md).

   Done: everything the app keeps in a workspace is in its `.instrument/`. `workspaceLayout` (`packages/workspace/src/lib/workspace-layout.ts`, its own package entry so the main process lays the folders out before the workspace is up) names `chats/`, `drafts/`, `topics/`, `skills/`, `apps/`, `memory/`, `.pre-chats/` and `window/` there, and nothing joins a folder name onto the workspace root. Existing workspaces move in the layout sweep (layout version 6, `move-app-folders.ts`), first in the sweep, so the 1.x migration and the chat split work on the chats and topics where they now live: a folder whose new place is free is renamed whole, one already there takes the old folder's entries one by one, and the paths stored into each are written where they went; an empty 1.x `tasks/` goes too. A chat's old folder went two ways (its work to the work folder in phase 3, its records into `.instrument/` here), so `remapMovedPath` follows every move holding a path, deepest first, and takes the first that leads to something there; a chat's grants and a topic's folders are read through it as well. The person's viewers (the file channel and local pages) show a chat's `attachments/` and the drafts, topics, skills, apps and memory folders inside a `.instrument/` (`PERSON_FOLDERS_IN_DATA_DIR`) and refuse the rest of it. The in-app browser's download fallback, used when the person's Downloads takes no file, stays `downloads/` at the workspace's top level, since what lands there is the person's. The workspace's machine folder keeps the person's work folders and the rest of this computer's data whichever folder the workspace is in.

   Done: the workspace moves only when the person picks a folder for it, never at boot on its own and never behind a prompt for Documents; new installs still start in `<userData>/workspace`. `workspaces.checkFolder` says what a picked folder is to it (one to move to, possibly holding finished work already; one that already holds a workspace, to open instead with `workspaces.open`; or one refused, with why: the app's own files, the home folder itself, its own folder or one around it, another known workspace, a `.instrument` that is no workspace's, one it cannot write, or a workspace whose sweeps have not finished; anywhere riskier, such as Documents or Desktop itself, a sign-in or startup folder, a temporary folder, the apps' data or a disk's top, comes with a warning the person can go past, and the home folder, a folder around it, and Documents, Desktop or Downloads themselves with a new `Instrument` folder inside offered first). `workspaces.move` records the move in the registry entry (`pendingMove`) and restarts; the next launch checks the folder again (where it really is, and with no link for its `.instrument`) and makes the move before any store opens (`finishPendingMove` in `apps/studio/src/electron-main/lib/workspace-move.ts`, whose comment gives the order): `.instrument/` renamed into the folder (copied beside it and renamed into place across volumes, marked as the move's own copy), the entry pointed there, the original renamed aside in the old folder, the rest of the old folder moved in beside it, the paths stored into the old folder written where they went, on Windows `attrib +h` on the new `.instrument` (also for a workspace first made outside userData), and last the aside deleted and the old folder in userData removed once empty. Each step can run again; once the target holds a whole copy no launch opens the original, and a delete of the aside that fails is retried by later launches. The default workspace's entry keeps its local id `default`, so its machine folder and sign-ins stay. Old absolute paths are read back through `remapMovedPath`, now including the window's tabs (Files addresses in the `layout` kept file) and the folders a message sent. Settings › Storage shows the Instrument folder and moves it (a folder picked in the system's panel, a confirmation that the app restarts to move it there). Once picked, the folder is the output folder too (`outputFolderPath()` reads the config's `outputDir`; `INSTRUMENT_OUTPUT`, the prompt, folder reach, Files' output place and the renderer, over `storage.location`, all follow it), and the app-data rules close the workspace's `.instrument/` rather than its whole folder, whose top level follows the person's rules and the output folder's. The 1.x and beta sweeps (and the 1.x `tasks/` folder the config names) belong to workspaces in the app's own data only; a workspace this build creates starts with current marks. A launch refuses, as a value and in a window of its own with no workspace behind it, a `workspace.json` whose format is newer than the build's (offering to check for updates, which runs the updater with no workspace) and a folder it cannot read or find (offering to choose it again in the system's panel, which is also how macOS gives back access to Documents, or to start over with a new folder in the app's data that keeps the workspace's ids and so its sign-ins). The registry keeps entries it cannot reach and compares folders by where they really are, case folded where the volume folds it; the dev panel's delete takes only a workspace's `.instrument/` and its machine folder. Relative paths are still to do.

   **The onboarding folder step** ([choose-where-instrument-keeps-files.md](choose-where-instrument-keeps-files.md)) calls the same routes Settings does, and writes no setting of its own: the registry entry is the record of where the workspace is, and the output folder follows it.

   - The suggestion is `workspaces.folder().suggested` (`instrumentFolderInDocuments()`). The routes take a folder that exists: a step that picks through a save panel makes the folder first.
   - `workspaces.checkFolder({ path })` answers `{ kind: "movable" }`, `{ kind: "workspace", name }` (the folder holds an Instrument folder: offer to open it), or `{ kind: "refused", reason }` (`app-data`, `current`, `home-or-drive`, `missing`, `not-absolute`, `other-workspace`, `pinned`, `taken`, `unfinished`, `unwritable`). A folder with other entries in it, dot entries included, is movable; only a `.instrument` that is no workspace's is refused.
   - `workspaces.move({ path })` checks again and answers a not-movable verdict as above, or `{ kind: "relaunching" }`, `{ kind: "canceled" }` (the person declined the restart over running agents) or `{ kind: "on-next-launch" }` (a build that cannot restart itself). `workspaces.open({ path })` answers `{ outcome: "relaunching" | "canceled" | "unsupported" | "not-a-workspace" }`.
   - Both restart the app. On a first launch the default workspace already exists in userData, empty, by the time onboarding shows, so the step moves it; the step has to come back after the restart, so mark it done (or onboarding's progress past it) before calling.

7. **Proof.** A seeded workspace migrates cleanly. Preview builds run the scenarios as real agent turns on a fresh macOS VM, then Windows, then Linux, with the sandbox checks.

## Migration

Every install ends in the same shape: the 1.x migration (kept: 1.x users exist), then the beta layout, then this. Formats that only ever existed in the 2.0 private beta may break rather than carry a shim. If the plan is abandoned, the moves are reversible: each is a rename recorded in the migration code.

## Not in this plan

- Stable provider identity for a chosen model, so a chat's model matches on another computer (progressive matching).
- A lock file so two computers don't run the same chat at once.
- The conversation as an append-only log (needed before the workspace is safe in iCloud on two computers at once).
- Syncing Claude subscription sessions; a phone app reading the workspace.
- Two workspaces open in one app process (the layout allows it; the process model doesn't yet).
