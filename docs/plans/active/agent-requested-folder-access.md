# Plan: agent-requested folder access

Status: proposal, not started. Owner: TBD. Expands the [Agent-requested folder access](user-chosen-working-folder.md#agent-requested-folder-access) section of the working-folder plan into its own design. Reintroduces a sub-agent over the `spawnAgent` primitive that [2026-07-15](../../decisions/2026-07-15-drop-agent-tool-for-attached-folder-mounts.md) deliberately retained.

## Summary

A user says "get the transcripts out of my dictation app." Nothing about that names a folder, and the folder in question is named after a reverse-DNS bundle identifier the user has never seen.

The feature has three parts, and only one of them is hard:

- **Approval**: the agent asks, the turn parks, the user allows or denies, the folder mounts. Almost entirely built.
- **Permission**: whether the operating system lets us read the folder at all. Measured, and largely a non-issue.
- **Discovery**: finding the folder. This is the whole feature, and getting it wrong hands the agent a map of the user's disk.

The design is a **discovery sub-agent**: a nested agent with a read-only view of the user's home directory, no native execution, and a return channel that is mechanically stripped of host paths. It finds the folder, asks the user for access to it, and reports back to the main agent in virtual paths only. The main agent never learns where anything lives.

## Why the main agent must not do the discovery

The tempting version is a read-only whole-system view for the main agent. It fails, for a reason specific to our architecture.

**Path knowledge is the capability.** The main agent's bash has real-binary escape hatches (`node`, `tsx`, `python`, `pnpm`, `git`, `ffmpeg`, `curl`), and once one of those is running it has the host user's full filesystem, network, and process access. [resolveNativeHostPath](../../../packages/workspace/src/lib/workspace-fs-layout.ts) quarantines *virtual* paths so a `/mnt` path cannot be handed to a subprocess, but it cannot do anything about a **real host path written directly into a script**. Nothing stops a Python script from containing a literal home path and calling `unlink` on it.

So the sandbox's containment currently rests on a quiet premise: **the main agent does not know any real host paths.** Every layer is built on it. [virtualizeOutput](../../../packages/workspace/src/lib/shell-commands/rg.ts) maps host roots back to mount points precisely "so the machine layout does not leak through match paths," and [redactHostPaths](../../../packages/workspace/src/lib/filter-shell-output.ts) collapses the home directory to `~` in every subprocess's output. Those are not cosmetic. They are load-bearing.

Giving the main agent host-wide reads would demolish that premise deliberately, then ask the rest of the sandbox to keep working without it. A read-only capability would convert directly into a write capability one `python -c` later.

**Hence the split.** Discovery happens in an agent that has no way to act on what it finds, and the finding is filtered before it reaches an agent that does. The boundary is not about privilege, it is about **information**: a path the main agent never learns is a path it cannot put in a script.

## Why not a purpose-built discovery tool

The obvious alternative is a `find_app_data(appName)` tool that resolves an app name to its data directories. It works, and it should still be rejected: it answers exactly one question. "Where does this app keep data" and "where are my Steam screenshots" and "where did that CLI put its config" are the same question wearing different clothes, and a tool scoped to application bundles answers only the first.

The generic version of that tool is a filesystem, a search program, and something that can read. We have all three. The sub-agent is what makes them safe to point at the user's home directory.

## The permission question, answered

Measured on macOS 26.6 from a process verified to lack Full Disk Access:

| Class | Examples | Gate |
| --- | --- | --- |
| Unsandboxed app data | `~/Library/Application Support/<bundle-id>/`, `~/Library/Preferences/` | **None.** Free read, no prompt |
| Installed-app metadata | `/Applications` listing, any `Contents/Info.plist` | **None** |
| Sandboxed app data | `~/Library/Containers/<id>/Data`, `~/Library/Group Containers/<id>` | `kTCCServiceSystemPolicyAppData`, new in macOS 26. One global prompt, `NSAppDataUsageDescription` |
| User folders | Desktop, Documents, Downloads | Per-folder TCC, `NS<Name>FolderUsageDescription` |
| Removable and network volumes | | `NSRemovableVolumesUsageDescription`, `NSNetworkVolumesUsageDescription` |
| Apple-protected | Safari, Mail, Messages, the Photos library, the TCC database, some Apple app containers | **Full Disk Access only.** No prompt is offered |
| Everything else under the home directory | | **None** |

The dictation-app case is row one: a plain SQLite file in `~/Library/Application Support/<bundle-id>/`, readable by any process today with no permission at all.

Three findings that shape the design:

**The macOS 26 app-data grant is global and one-shot.** After a single Allow, eight previously untouched third-party containers read with no further prompt. One dialog for the life of the install.

**TCC attributes the prompt to the signed bundle, not the process.** A prompt raised by a native binary three processes deep inside an Electron app named the `.app` bundle. That is our topology exactly, so a read from the main process or from an `execa` child raises a dialog saying Instrument, with our reason string.

**Apple's own protected apps are permanently out of reach.** No grant short of Full Disk Access exists, and none is offered. The sub-agent must recognize this class and say so once rather than probing around it.

Windows and Linux need no consent story of their own: `%APPDATA%`, `%LOCALAPPDATA%`, `~/.config`, `~/.local/share`, and `~/.var/app` are ungated for the targets we ship.

So: **no Full Disk Access, no new entitlements, no install-time consent.** Add the usage-description keys and request in context.

## Design

### 1. The discovery agent

A second entry in [AGENTS](../../../packages/workspace/src/agents/all.ts), spawned through the `spawnAgent` primitive that already threads through tool execution and already runs nested sessions with working abort, replay, and completion.

**Its filesystem is one read-only mount.** `buildWorkspaceFsLayout` already expresses this: a mount is a host root plus a `readOnly` flag, and read-only mounts already get symlink containment on every read plus native-bridge quarantine. The discovery layout is the ordinary layout with one extra read-only mount whose host root is the user's home directory.

**Home, not the filesystem root.** Application data lives under the home directory on all three platforms, so `/` buys no discovery reach while adding other users' homes, system configuration, and every credential store on the machine. Add only the small per-platform read-only locations that discovery genuinely needs: `/Applications`, `/usr/share/applications`, `%ProgramFiles%`.

**Its tools are read-only, and it has no native execution.** No `node`, `tsx`, `python`, `pnpm`, `git`, `curl`, `ffmpeg`, or `agent-browser`. This is the point of the whole design: [just-bash](../../architecture/agent-sandbox.md) is a TypeScript interpreter over a virtual filesystem we supply, so with the escape hatches removed there is no process on the machine that can act on anything the sub-agent learns. Path knowledge inside the sub-agent is inert. Agent tool sets are already per-agent (`agentTools` on the agent definition), and `createBashEnv` already assembles its command list from a filter, so both are configuration rather than new machinery.

**One native binary survives, and it is the important one.** `rg` is a real ripgrep, and it is already built on the assumption that it is read-only over host paths outside the task: [rg.ts](../../../packages/workspace/src/lib/shell-commands/rg.ts) refuses `--pre`, `--pre-glob`, `--hostname-bin`, and `-z`/`--search-zip` specifically because those "would turn a read-only binary into an execution vector," resolves every path argument through `resolveReadOnlyHostPath`, re-checks symlink containment that a real binary would otherwise follow out of its mount, and virtualizes its output. It is exactly the primitive this needs, hardened for this reason, already tested. It is also the only thing that makes searching a real home directory fast enough to be usable.

### 2. What the discovery agent may not read

The main agent's denylist is about what can be *requested*. The sub-agent's is stricter and different in kind: it governs what the discovery mount *contains*, because read access alone is total compromise for some of these.

- Credential stores: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.git-credentials`, `~/Library/Keychains`, password-manager data
- Browser profile directories, which hold cookies and session tokens
- Our own application-data directory, including every task's private directory

This is not optional, and the `~/.ssh` entry in particular is the whole argument: [gitSubprocessEnv](../../../packages/workspace/src/lib/git.ts) goes to considerable trouble to keep the user's SSH keys and `~/.git-credentials` unreachable, and a discovery agent that can `cat` them makes that work pointless.

**Enforcement is two-sided, because ripgrep walks the real directory and the virtual-filesystem mask does not apply to it.** `rg` already handles the equivalent case for the task's private directory by injecting a `--glob` exclusion anchored to each search root. The denylist needs the same treatment: excluded as globs in `rg`'s argv *and* masked in the virtual filesystem, or a single `rg` invocation reads straight past it.

### 3. The return channel, filtered mechanically

The sub-agent's transcript never reaches the main agent. Its tool calls, its intermediate reads, and the paths it walked are not context the parent gets to see.

What comes back is a short report plus whatever mounts were granted. And the report is **passed through `redactHostPaths` and `virtualizeOutput` programmatically before the parent sees it**, not merely written under a prompt instruction to avoid host paths. The sub-agent is a language model and will quote a real path in prose sooner or later; the parent's ignorance of host paths is a security property and must not depend on another model's discipline.

So the main agent's view of a successful discovery is roughly: the app's data is now at `/mnt/Handy`, it holds `history.db`, and that file is a SQLite database with a `transcription_history` table. Everything it needs, and nothing it can turn into a host path.

### 4. Requesting access

`request_folder_access({ path, reason, suggestedAccess })` is called **by the discovery sub-agent**, which is the only party that knows the path.

It runs on the interactive-tool rail that already exists. [agent.ts](../../../packages/workspace/src/machines/agent.ts) diverts anything `isInteractiveTool` names into `pendingToolCalls`, enters `WaitingForPendingToolCalls`, and emits `agent.paused`; the connectors work generalized the other half with a discriminated resolution schema keyed on tool name and a `resolveInteractiveToolCall` RPC the renderer calls with a typed output. Adding a tool is a union member and a card. Because the rail parks a nested session the same way it parks a top-level one, the whole chain suspends on the user with no new lifecycle work.

The grant lands on the **task**, not on the sub-agent, so the mount is there for the main agent when the sub-agent returns.

### 5. One consent surface, sized to what is actually protected

Two possible consent surfaces, ours and the operating system's, and showing both for one decision reads as broken. Route by class:

- **Path needs no OS permission** (unsandboxed app data, ordinary home folders): the in-chat card approves directly. There is nothing for the OS to ask, so asking twice is theater.
- **Path is in a TCC class** (Documents, Desktop, Downloads, containers, volumes): the card's Allow opens the native folder picker pre-navigated to the requested path, so the user's selection carries both consents at once. [showFolderPicker](../../../apps/studio/src/electron-main/rpc/routes/utils.ts) needs a `defaultPath` for this; it takes no arguments today.

Friction ends up proportional to how protected the path really is.

**A wrinkle the sub-agent introduces:** an `rg` walk across `~/Library/Containers` trips the macOS 26 app-data prompt *during discovery*, before any folder has been requested, with no card on screen to explain it. Either warm that grant at a moment the user can make sense of, or keep the container class out of the default search and reach it only after an explicit request.

### 6. Access level

[FolderAttachment.AccessSchema](../../../packages/workspace/src/schemas/folder-attachment.ts) already carries `read-only` and `read-write`, the layout already honors it, and the agent prompt already tells the model that attached folders are one or the other. The tool suggests, the card defaults to the suggestion, the user can change it.

Two rules belong in the tool schema rather than the prompt, so the model cannot drift off them:

- **Anything discovered suggests read-only.** Retrieval is the use case, and writing into another application's live database is a corruption bug rather than a feature.
- **Read-write is suggested only for folders holding the user's own work**, and `effectiveFolderAccess` already refuses it for anything overlapping the workspace root.

## Is this a reversal of the 2026-07-15 decision?

No, and the distinction is worth keeping straight because the surface looks identical.

That decision dropped a `retrieval` sub-agent that was an **indirection over folders the user had already attached**. Mounting those folders read-only at `/mnt/<name>` let the main agent read them directly, which removed the sub-agent's entire reason for existing. It also explicitly kept the machinery: "re-introducing sub-agents later means defining a new agent, adding its name to the list, and writing a fresh tool over the retained `spawnAgent` primitive."

This sub-agent does the opposite job. It operates **where no grant exists yet**, which is precisely the case a mount cannot cover, since a mount is what a grant produces. The old one was a slower path to files the main agent could already have; this one exists so the main agent can never have the thing that would be dangerous to hold.

## The honest limit

The main agent gets a mount named after the folder, and a name is a hint. Told that `/mnt/Handy` exists, a model that knows platform conventions can guess the host path and write there through a native subprocess, bypassing a read-only mount entirely.

This is already true of every user-attached folder and is not created by this plan, but discovery makes it easier to reach. The claim to make, and not to exceed: **the boundary stops the main agent from acquiring a map of the filesystem, not from guessing one path it was already granted read access to.** The difference is real. A guess is one folder the user consented to; a map is every folder on the disk.

One cheap mitigation fits existing precedent. `bridgeInlineCodePaths` already scans inline program text for quoted `/task/` and `/mnt/` literals and fails fast on the latter. Extending that scan to host-absolute literals (`/Users/`, `/home/`, `C:\Users\`) catches the direct spelling. String concatenation defeats it, so it is guidance rather than a boundary, which is exactly how [agent-sandbox.md](../../architecture/agent-sandbox.md) already describes the script scanner. Worth having, not worth overselling.

The complete fix is OS-level containment of the native hatches, which we have [decided against](../../decisions/2026-07-15-userland-agent-sandbox.md) for good reasons that have not changed.

## Prerequisites

**The asset origin.** It serves exactly what the agent can read, which is the right invariant and the reason this needs saying: a newly granted mount is immediately readable over an unauthenticated, wildcard-CORS loopback origin keyed by a guessable task id, and agent-authored HTML runs on that origin for real. The unguessable per-boot label and non-wildcard CORS in [asset-origin-is-open-to-any-local-reader](../../findings/asset-origin-is-open-to-any-local-reader.md) are prerequisites here, for the same reason the working-folder plan makes them prerequisites for `/work`.

**Info.plist usage descriptions.** Add `NSAppDataUsageDescription`, `NSDocumentsFolderUsageDescription`, `NSDesktopFolderUsageDescription`, `NSDownloadsFolderUsageDescription`, `NSRemovableVolumesUsageDescription`, and `NSNetworkVolumesUsageDescription` to `mac.extendInfo` in [electron-builder.ts](../../../apps/studio/electron-builder.ts), beside the local-network string already there. Without them the prompts still appear, with generic text instead of our reason. Worth doing whether or not the rest ships.

## Phases

1. **Usage descriptions.** Independent, trivial, improves every prompt we already raise.
2. **The request tool.** Interactive tool, resolution-union member, transcript card, picker `defaultPath`, requestable-path denylist. Ships against a path the main agent guesses, which is the degraded but useful version.
3. **The discovery agent.** New agent definition, a read-only tool set, a bash environment built from a restricted command list, the home mount, and the read denylist enforced in both the virtual filesystem and `rg`'s argv.
4. **The filtered return channel.** Mechanical redaction of the sub-agent's report, and the parent-visibility rules for a nested session's transcript.
5. **Prompt work**, which decides whether any of it gets used.

## Open questions

- **Does an open-panel selection suppress the TCC prompt under the new app-data class?** Long established for Documents, Desktop, and Downloads. The app-data class is new in macOS 26 and unverified, and it decides whether phase 2 keeps one consent surface or degrades to two. Answering it needs a real signed build: a development Electron is ad-hoc signed and carries a different TCC identity.
- **How does the user see what the sub-agent did?** The parent is denied the transcript for containment reasons, but the *user* should probably be able to inspect a search across their home directory. That is a UI surface with no obvious home in the current transcript model.
- **Does a granted mount outlive the task?** Per-task means re-asking forever; remembered means a grant list the user can see and revoke, which is a settings surface this plan does not have.
- **Should the main agent be able to spawn discovery directly, or only on the user's behalf?** A main agent that can start a home-directory search whenever it likes is a different proposition from one that can do so only in response to a request that plainly needs it.
- **What does the sub-agent do when the answer is Full Disk Access?** Asked about Messages or Safari history, no grant we can request exists. Saying so once and stopping is right; the failure mode is probing neighboring paths until it gives up noisily.

## What this does not change

- The main agent's filesystem view is exactly as strict as it is today. It gains no reads, no paths, and no new commands.
- `/mnt` semantics are unchanged. A granted folder is an ordinary attachment that happened to be initiated by an agent, with the same naming, containment, and quarantine rules.
- No Full Disk Access, no new entitlements, no install-time consent.
