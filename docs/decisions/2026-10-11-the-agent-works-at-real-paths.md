# The agent works at real paths, held to the Permissions rules

## Context

The agent saw the user's folders at virtual paths: its chat's folder at `/task`, each folder it reached at `/mnt/<name>`, skills under `/skills/<source>`. Native commands (python-native, node, uv, pnpm, ffmpeg, git, osascript) were handed only the chat's folder, every other path quarantined, and their output was rewritten back to virtual paths. The layout existed because nothing at the operating system level stopped a native command from writing anywhere, so a host path was never allowed to reach one.

It never contained anything a script reached on its own, and it cost the agent context and detours: inputs copied into the chat's folder to run a nine-line script, copies handed back instead of the person's file, git refused on a given folder. The permissions baseline measured it: every pandas and ffmpeg run on a folder copied its input first.

Settings › Permissions now decides reach by rule (built-in places, the person's folder rules, the chat's grants, the deepest rule winning), and the same rules hold every layer: the shell's own commands and file tools through a filesystem wrapper, and native commands through a Seatbelt profile on macOS.

## Decision

- **Real paths everywhere.** Each folder the agent reaches is mounted in its shell at its own path on the disk, its working directory is the chat's real folder, and native commands get their arguments as typed. The path bridge, its quarantine, output rewriting and mount names are gone.
- **Nested folders mount once.** just-bash's `MountableFs` refuses a mount inside another, so a folder inside one already reached (a grant inside the home folder, the chat's folder inside the workspace) is reached through the outer mount, and the rules decide what in it may be read or changed.
- **The app's own folders are rules too.** The workspace is missing to the agent except for its chat's folder, the skills, and for the chat its apps; the chat's internals are missing inside its folder; the skills the app ships are read-only. These rank above anything the person sets.
- **The default under home is unchanged.** The home folder was already mounted read-only in every chat. It stays readable, so the agent can look and then ask for the right folder; changing anything outside a grant asks first, and the built-in places (Desktop, Documents, Downloads, iCloud Drive, drives, other apps' files) ask before reading too. Passwords and keys are closed.
- **Windows spells paths as Git Bash does.** The shell is POSIX, so `C:\Users\sam` is `/c/Users/sam` inside it, converted at the edge in both directions; paths shown to the person stay in Windows form. This follows Claude Code, which runs its Bash tool through Git Bash on native Windows. Codex runs PowerShell with Windows paths, which does not fit a POSIX shell, and WSL's `/mnt/c` names a different machine. `MountableFs` mounts any absolute path, so `/c/...` needs no patch.

## Alternatives

- **Keep the virtual layout and add the rules beside it.** Rejected: the rules make the hiding redundant, and the hiding is what cost the detours.
- **One mount per folder, nested allowed.** Rejected: it needs a just-bash change, and the rules already say what a nested folder may do.
- **Ask first for reading anything under home that no rule names.** Rejected: an agent that cannot look cannot find what to ask for, and the virtual layout already let it read there.
