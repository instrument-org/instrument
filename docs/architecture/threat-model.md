# Threat model

What Instrument protects, what it deliberately does not, and how to decide whether a finding needs a fix. Reviewers, people and agents alike, judge a finding against the "When a finding needs a fix" section, not against the worst outcome they can imagine.

## What Instrument is, for this document

A desktop app one person runs on their own computer. Its agent works for that person, with their account's privileges, on things they asked for. The person is not an adversary: anything the agent can do, they can do too.

## Why the agent has limits at all

The agent can do something the person did not want. It can misread a request, reach further than asked, or follow instructions planted in something it read: a web page, an email, a document, a result from a connected app.

We do not try to detect or mark planted instructions. Outside content reaches the model as it was returned, and the system prompt says once that it is information, not the person speaking ([decision](../decisions/2026-10-09-outside-content-arrives-last-and-unmarked.md)). Resisting it is the model's job. Instrument's job is that whatever the agent decides, it cannot cross the lines below.

Out of scope entirely: the person themselves, malware already on the computer, another person with access to the computer, a compromised operating system, and Instrument's own servers or builds.

## What we protect

1. **The person's folder settings.** Settings › Permissions, and the cards the person answers, decide which folders the agent may read and change. A folder set to Not allowed stays closed: if Downloads is Not allowed, "delete everything in my Downloads folder" is refused, and the person changes the setting if they mean it. What the person attaches to a message, or picks on a card, is open to that chat whatever Settings says about where it is; asking for it in words still respects Not allowed. The places where the person's own sign-ins live (the Keychain, browser profiles, SSH and cloud keys, password managers) start closed or asking, and stay that way until the person opens them.
2. **The app's secrets.** Provider keys, the account sign-in, connected apps' credentials, and the per-launch keys the app's own local servers check. The agent never reads or changes them, and never changes the person's permission settings.
3. **The sandbox itself.** Code the agent writes or downloads runs inside the sandbox. Nothing the app runs outside it (a connected app's local server, the installer for the managed Python, the app's own code) is loaded from or configured by a place the agent can write, and the agent cannot change what runs at login or when a shell starts (login items, shell startup files). No AppleScript the agent writes runs. On macOS the app's own fixed scripts drive Mail, Notes and Messages, and what the agent passes reaches them as data, never as script text; Calendar, Reminders and Contacts go through the app's own Swift helper. Each of these apps is used only once the person allows it, for one chat or always, on its card or in Settings › Permissions, and macOS asks them once besides. The scripts run outside the sandbox, since an app takes no commands from a sandboxed sender, so an app they drive does what the script asks of it, such as sending a message.
4. **The person's files through the app's own operations.** A migration, a move of the Instrument folder, or a cleanup never loses or overwrites the person's files.

## What we do not protect

- **Separation between chats.** Every chat belongs to the same person. One chat can leave files, installed packages, or skills that another chat later uses, and that is expected.
- **The agent's choices inside the workspace.** Inside the workspace (its chats, its topics and their folders, the Instrument folder), what the agent chooses to do is not defended, whether or not something steered it: a chat the agent tags with a topic, for example, reaches that topic's folders. The four lines guard everything outside the workspace.
- **Network access.** The agent can reach any address. Network rules are too fine-grained for most people to reason about, and the agent drives a real browser, which could not work behind them anyway. So if planted instructions steer the agent into sending something it was allowed to read, Instrument does not stop it. What limits that is the folder settings (what the agent can read at all) and the model's judgment.
- **The in-app browser's sessions.** The in-app browser is the agent's as much as the person's: the agent browses as the person, with the sessions the person signed in to there. The person's other browsers stay closed (line 1).
- **What the agent leaves in folders it may change.** If a folder is open to the agent, it can leave a script or file there that runs or is opened later. Line 3 keeps that out of the app's own programs and out of login and shell startup, not out of every program the person uses.
- **A repository's hooks on Windows, by renaming `.git`.** A hooks folder in a folder the agent may change is closed to changes on every platform, but on Windows MXC holds a folder by its name and has no mount points: a program can rename a repository's `.git` aside, write a hook into it and rename it back, and the hook runs the next time the person uses git there. This is accepted. Only a badly misaligned agent would set out to do it, and every way to stop it (denying the rename, a read-only `.git`) breaks git in the folders the person opened for it ([decision](../decisions/2026-10-17-accept-the-git-rename-gap.md)).
- **Whether a file exists.** A refusal can reveal that a name exists in a folder the agent may not read. File names and sizes are not treated as secrets.
- **The app's own records from the agent's view.** Other chats' records and the workspace's settings are closed to the agent so it does not wander into or rewrite the app's state, not because they are secret from the person. They are closed to it as files, and it reaches them on purpose through the `chat` and `memory` commands.
- **Running out the person's computer.** A runaway command is stopped by timeouts and limits, not prevented from starting.
- **Each thing the agent does, one at a time.** What the person allows is a folder and an app, and nothing finer. Every command the agent runs inside what they allowed is the agent's own, and no one is asked about it: a person asked to answer for each one would stop reading the questions, which is worse than not asking. So "the agent did something in a folder I opened that I did not ask for" is not what the folder settings are for; what limits it is which folders and apps are open at all, and the model's judgment inside them. A classifier that reads each tool call and raises the few that are genuinely dangerous is the way that line could move, and it is not in this release.

## Windows

On Windows the agent's programs are held by Microsoft's MXC sandbox, built from the same rules as macOS and Linux, when the app runs with `INSTRUMENT_MXC=1` and a canary run on that machine shows the container holds ([windows-sandbox.md](windows-sandbox.md)). It needs Windows 11 24H2 or later. Without it, the shell's own commands and the file tools follow the folder settings, but a program the agent starts (python, node, git, a script) can read and change anything the person can, the app's secrets included, and Settings › Permissions says so. Two commands carry their own fences there: `rg` leaves the app's own data out of its searches, and `git` refuses the options that would let it run other programs. No new per-command fence is added for a gap that only exists because Windows runs without the sandbox.

Windows is not the only place a program the agent starts runs without an operating-system sandbox. On Linux without user namespaces (an AppImage on Ubuntu, which restricts them to programs with an AppArmor profile) bubblewrap cannot start, and on a Mac running inside another sandbox Seatbelt cannot apply, since it does not nest. Settings › Permissions says so there too, and the same holds as on Windows: the shell's own commands and the file tools follow the folder settings, and a program the agent starts can reach what the person can.

## How the lines are held

One set of rules (`packages/workspace/src/lib/permissions/`) decides every path: the person's settings, the built-in places (including the fixed lists of sign-in places and startup files), and the app's own folders. Three places ask it:

- **Shell commands** the shell runs itself (`cat`, `ls`, `sed`, ...): just-bash runs them against folders mounted at their real paths, and every read and write asks the rules first.
- **The file tools** (read, write, edit): they read and write through the same filesystem the shell uses, so a path is held to the rules where it really leads.
- **Programs the agent starts** (python, node, git, ripgrep, ...): the operating system holds them, Seatbelt on macOS, bubblewrap on Linux and MXC on Windows, with profiles built from the same rules.

Some commands also check their own arguments before they run, as a second layer for an easy mistake: `git` refuses options that run other programs, `node` refuses debugger flags, `agent-browser` refuses subcommands that reach outside the browser, and `rg` refuses flags that run another program. On macOS and Linux the operating system is the boundary and these are not; on Windows they are what there is.

Leaving the app's own data out of an `rg` or `du` walk keeps their output clean on macOS and Linux, where the system refuses those folders anyway.

The app's own ways of showing the person a file, the file viewers through the file channel and a local page in the in-app browser, hold to a second rule of their own, by name (`apps/studio/src/electron-main/lib/refused-files.ts`). It refuses a workspace's records and the machine folder, so the person's own screens stay out of the app's data whatever they are asked to open.

## Defenses that hold these lines

Each of these holds one of the lines above, and a change that weakens one needs the same care as a change to the rules themselves.

- The sign-in places are closed, and the passwords place asks even when the person uses folders without asking (lines 1 and 2).
- The startup places, login items and shell startup files, are closed to changes whatever the settings say (line 3).
- The runtime folders (the managed Python, the skill environments, the preload, `bin`) are read-only to chats, and the skills the app ships are built in folders no chat reaches (line 3).
- Installs are held to hash and release-age checks (line 3).
- The browser bridge passes only the commands on its list, a local file is checked before a page loads it, and `tab read` refuses a file the agent could not open itself (line 1).
- App credentials are bound to their service's origin, and an app's manifest cannot name a command line (lines 2 and 3).
- `git` and `rg` check their arguments, and `rg` and `du` leave the app's own data out of their walks: a second layer on macOS and Linux, and the only one on Windows.

## When a finding needs a fix

Fix it when it lets the agent, by mistake or because content steered it:

- read or change a folder the person's settings refuse, without asking them;
- read or change the app's secrets or the person's permission settings;
- get code run outside the sandbox, or at login or shell start;

or when one of the app's own operations can lose the person's files.

Do not fix it, and say so in the review, when the finding is:

- one chat affecting another, or a shared cache or skill that only sandboxed code uses;
- revealing whether a file exists, or its size;
- something the agent could only do with access it already has, such as sending allowed files somewhere or deleting allowed files;
- a race that needs another program on the computer acting at the same moment (a link the agent planted itself is not a race);
- a way around a filter that only keeps output clean;
- a Windows gap that the Windows sandbox will close;
- a program on Windows renaming a repository's `.git` to write its hooks, which is accepted (above).

A fix with no cost (no new special case, no second code path, nothing more for the model to read) can still be taken for any finding. A fix that adds any of those has to protect one of the four lines.
