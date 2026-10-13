# The shell stays just-bash, and real programs do the rest

Date: 2026-10-12

Follows [the agent works at real paths](2026-10-11-the-agent-works-at-real-paths.md). Two of the calls below have records of their own, [`python` and `node` run native](2026-10-12-python-and-node-run-native.md) and [programs on the PATH run natively](2026-10-12-programs-on-path-run-natively.md); this one gathers the rest of what was settled that day about the agent's shell and what it may reach.

## Context

Once native commands were held to the Permissions rules by the operating system (Seatbelt on macOS, bubblewrap on Linux), most of what the shell had withheld from the agent protected nothing: a script could already do it. The questions left were which shell to build on, which programs run natively and which stay builtins, what stays closed whatever the rules say, and what Windows gets before it has a sandbox of its own.

## Decisions

### `python` and `node` are native, and `node` has a guarded `tools`

The WebAssembly Python and `js-exec` are gone; `python`, `python3` and `node` are the real interpreters, under the same profile as every native command. A script calls a connected app's tools through a `tools` global that a preload defines over the process's IPC channel, answered by the same hook `app call` uses. It is defined only when nothing else defined it, is non-enumerable, and can be overwritten, so a package that reads a global by that name collides only if it reads an undeclared one. See the [record](2026-10-12-python-and-node-run-native.md).

### Any program on the PATH runs by name

A name no builtin or command of ours answers runs the program on the PATH under the same rules, with no allowlist and no card per program: the folder rules are what hold a program, and they hold any program a script starts. `which`, `command -v`, `type` and `hash` report what exists. See the [record](2026-10-12-programs-on-path-run-natively.md).

### No deny on Unix sockets

The network is open to native commands, so denying Unix-domain sockets (Docker's, a database's) would close a door beside an open one. The one socket held back is the SSH agent's: `SSH_AUTH_SOCK` reaches a command only when the chat may use `~/.ssh`, and on macOS the profile refuses connecting to the agent's socket by its path otherwise, since the agent signs as the person.

### Command-line sign-ins ask first; browsers and the Keychain stay closed

The folders and files command-line tools keep their sign-ins in (`.ssh`, `.gnupg`, `.aws`, `.azure`, `.config/gcloud`, `.kube`, `.docker/config.json`, `.netrc`, `.git-credentials`, `.config/gh`, `.config/op`, `.password-store`) are Ask first, one card per folder, and the card says plainly that the folder holds keys or passwords. "Use folders without asking" does not open them. The Keychain, browser cookies and profiles, and the 1Password group container stay Not allowed: nothing a person asks of the agent needs them, and any of them is enough to act as the person everywhere.

### Windows ships without an OS sandbox, and says so

Native commands on Windows run unconfined until Windows' own sandbox can be adopted. Settings › Permissions says so on Windows in plain words and links to [windows-sandbox.md](../architecture/windows-sandbox.md). Microsoft's MXC is the candidate, for Windows 11 24H2 and later, once [microsoft/mxc#1464](https://github.com/microsoft/mxc/issues/1464) is fixed: inside its container Node's `realpath` fails on every path and Git for Windows cannot read its working directory. Older Windows stays as it is, with the notice.

### The shell stays just-bash: brush and Bash Kit ruled out

**brush** is a full bash for people (about three thousand compatibility cases against real bash, real job control). Its builtins are only the shell's own: `ls`, `cat`, `grep`, `find`, `sed` and `awk` come from uutils as spawned processes, and it reads and writes through the real filesystem, so the rules could only be held at the operating-system level, which Windows does not have yet. It embeds from Rust only, with no Node binding, and its Windows support is a preview.

**Bash Kit** is the closest analog to just-bash, in Rust: about 170 commands, a virtual filesystem, a Node package with prebuilt binaries for all three platforms, and 97.3% of the Oils cases bash passes. Three blockers, each confirmed in its source:

- A builtin written in JavaScript returns only a stdout string: exit status only by throwing, no stderr on success, binary stdin not preserved, and the synchronous executor deadlocks with one registered.
- It spawns no processes by design, and its pre-exec hook can veto or rewrite a script but not hand a command to a real binary, so native `git`, `python`, `node` and `uv` would have no way in.
- Its filesystem cannot be implemented in JavaScript (in-memory, a real directory, or a native handle only), so the rules layer would need rewriting in Rust.

Command coverage against just-bash was mixed rather than ahead (Bash Kit had `xargs -n/-I/-P`, `grep -P`, `cut --complement` and `jq @csv`; just-bash had `cp -r` on directories, `touch -d`, `ls -S`, `gzip -c` and `du -a`, which Bash Kit's release failed), and nearly all of its recent commits come from one author, against a much wider set of contributors and users for just-bash. Gaps in just-bash are fixed as a patch plus an upstream pull request ([just-bash-upstream.md](../architecture/just-bash-upstream.md)).

### Heavy text commands stay builtins, for now

Running the heavy commands natively is much faster. Measured on macOS, builtin against the real tool under a profile shaped like ours:

| Work | Builtin | Native |
| --- | --- | --- |
| `grep -r` over 20,000 files | 3.1 s | 0.4 s (`rg` 0.2 s) |
| `find -name` | 557 ms | 32 ms |
| `sed -i` over 1,000 files | 447 ms | 257 ms |
| `sort` of 34 MB | 2.8 s | 0.8 s |
| `awk` over 100,000 records | 281 ms | 36 ms |
| `jq` over 40,000 objects | 160 ms | 55 ms |

Small calls (`cat`, `ls`, a short `sed`) cost the same either way, a few milliseconds of spawn under the sandbox. `sort`, `awk`, `jq`, `find`, `grep -r` and `sed` without files were the candidates; the commands that take paths (`cat`, `ls`, `cp`, `mv`, `sed -i`, `head`) stay builtins regardless, so a card names the exact path. They are parked because macOS ships BSD tools while models write GNU flags (`sed -i` needs `sed -i ''`, there is no `grep -P` or `find -printf`, and `awk` lacks GNU's extensions), and Windows has no native coreutils, so builtins stay there anyway.

When this returns, the exact path a native command was refused is recoverable rather than read from its output: on macOS, deny rules tagged with a per-run message and one `log stream` filtered to the sandbox's reports (every report arrived before the command exited, with no misattribution under concurrency); on Linux, a FUSE mount bound over each closed folder that refuses and records the path. Whether the path was named or only walked past is decided by whether an argument, resolved against the working directory, is that path or holds it.

## Alternatives not taken

- **An OS sandbox as the only layer, with no builtins.** Rejected while Windows has none, and because builtins name the exact path a card asks for.
- **A deny on every Unix socket.** Rejected as above: the network is open, and the socket worth holding back is the SSH agent's.
- **Sign-in folders Not allowed, as before.** Rejected: `ssh host` and `aws s3 ls` are ordinary requests, and a card per folder that says what it holds lets the person decide.
