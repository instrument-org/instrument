# GNU text commands on bundled uutils

**Status:** open, measured 2026-10-15; a prototype routes the commands below by a fixed table and waits on a decision to ship it.

[The shell stays just-bash](../decisions/2026-10-12-the-shell-stays-just-bash-and-real-programs-do-the-rest.md) parked native text commands for two reasons: macOS ships BSD tools while models write GNU flags, and Windows has no coreutils. uutils removes both. It is the MIT-licensed Rust reimplementation of GNU coreutils (findutils, diffutils and grep beside it), prebuilt for every target Studio ships, and Ubuntu 26.04 already uses it as its default `coreutils`. This page records what bundling it buys and costs, how far a native start can be made cheap, the routing options, and what brush would change.

## Compatibility

The corpus is 245 argv-level cases mined from 21,313 recorded agent `bash` calls (production and evals): the most frequent invocations of `sort`, `uniq`, `cut`, `wc`, `tr`, `comm`, `join`, `find`, `xargs`, `grep`, `diff`, `date` and `stat`, every flag that failed in the record (`sort -g` 41 times in 37 sessions, `grep -H` 28 in 22, `grep -P`, `xargs -I{}`/`-n1`, `head -q`), the missing commands (`cmp` 22 times, `realpath`, `shuf`, `dd`), the BSD spellings (`stat -f` 217 times in 5 sessions, `date -j -f`, `ls -lT`), and a few `sed` and `awk` shapes. Each case runs with no shell (argv, stdin from a file, `TZ=UTC`, `LC_ALL=C.UTF-8`) against GNU coreutils 9.7, findutils 4.10, diffutils 3.12, grep 3.12 and gawk 5.3 on Ubuntu as the reference. A case passes when stdout and success match. The Windows column counts a path printed with backslashes as a pass, to show what the tools compute; as printed, Windows passes 188, since `find`, `grep -r` and `realpath` print relative paths with backslashes (`reports\b.md`).

| | just-bash builtins | uutils macOS arm64 | uutils Linux arm64 | uutils Windows x64 | macOS's own BSD tools |
| --- | --- | --- | --- | --- | --- |
| all 245 | 167 | 227 | 229 | 211 (188 as printed) | 175 |
| `sort` (27) | 12 | 27 | 27 | 26 | 26 |
| `uniq` (5) | 3 | 5 | 5 | 5 | 3 |
| `find` (24) | 18 | 23 | 23 | 20 | 19 |
| `grep` (33) | 25 | 33 | 33 | 32 | 31 |
| `xargs` (8) | 5 | 8 | 8 | 8 | 8 |
| `date` (11) | 5 | 10 | 10 | 10 | 1 |
| `stat` (9) | 7 | 9 | 9 | none built | 0 |
| `cmp` (5) | 0, missing | 5 | 5 | 5 | 2 |
| `diff` (11) | 5 | 3 | 3 | 2 | 9 |
| `sed` (14) | 12 | 12 (uutils sed 0.1.1) | 12 | 12 | 11 |
| `awk` (12) | 10 | 9 (goawk 1.32) | 9 | 9 | 9 |

Every flag that failed in the record passes on uutils except the BSD spellings, which GNU refuses too. What uutils still gets wrong:

- `find -newermt` parses no date at all in findutils 0.10.0 (`I cannot figure out how to interpret ‘2026-01-01’ as a date or time`), where the builtin carries it as a patch.
- On Windows, `find` joins what it prints with backslashes, so `-path '*/.*'` and `-prune` written with slashes match nothing, and `stat` is not built.
- `xxd` is not part of coreutils; `od -An -tx1` covers it.
- ugrep 7.5, which Claude Code uses for `grep`, failed three cases uutils grep 0.2.0 passes (it drops the `./` of a walk from `.`, and refuses `\?` under `-a`), and ships prebuilt only for Windows.

The builtins diverge silently as well as loudly: `sort -n` reads `1e3` as a thousand, `uniq -c` pads to four columns, `sort` collates non-ASCII lines in neither GNU's `C` nor its UTF-8 order, `date` prints `%-d` literally, `sort -o` writes nothing, and `tr '\0' ' '` replaces the digit `0` rather than NUL.

## diff and sed

Neither uutils project is far enough along to replace a builtin, and neither builtin is good either.

**diff.** The builtin passes 5 of 11 and uutils diffutils 0.5.0 passes 3. Both refuse `-r`, `-w` and `-y`, which GNU passes; uutils also refuses `-i`, and prints `4a5,5` for an append where GNU prints `4a5`, so its plain and stdin cases fail too. The builtin's `diff -u` leaves out the timestamps on the `---`/`+++` lines, which is why uutils wins that one. diffutils is the quietest of the uutils projects: 26 commits from 5 people in the last 90 days, no release since 0.5.0 in January; `main` has added side-by-side output since, and no directory diff. Its `cmp` passes every case.

**sed.** A tie, 12 of 14 each, failing different cases. uutils sed 0.1.1 misses `0,/re/` and `-z`; the builtin misses `-z` and GNU's one-line `2a\text`. sed is busier (92 commits from 13 people in 90 days) and `main` has `-z`, unreleased since 0.1.1 in December 2025. Neither is worth switching for now; sed is worth checking again at its next release.

For scale: coreutils had 1,518 commits from 141 people in the same 90 days, findutils 95 from 20, grep 58 from 9.

## Speed

Measured on an M5 Max Mac Studio through `run-bash` with the app's Seatbelt profile.

| Work | Builtin | uutils through the shell | uutils in a terminal |
| --- | --- | --- | --- |
| `grep -r` over 20,000 files | 2.7 s | 0.35 to 0.45 s (`rg` 0.19 s) | |
| `find -name` over 20,000 files | 982 ms | 63 ms | 29 ms |
| `sort` of 34 MB | 2.4 s | 1.1 s | 0.54 s |
| `sort -g` of 34 MB | refused | 0.74 s | 0.18 s |
| `cut \| sort \| uniq -c` of 34 MB | 1.4 s | 1.0 s | 0.18 s |
| `sort \| uniq -c \| wc -l` of 34 MB | 3.7 s | 3.8 s | 0.56 s |

A walk is where native wins outright. Large data crossing a pipeline gains little, because each stage's whole output is collected as a string, handed to the interpreter, and encoded again for the next stage. The carriage-return collapse every native shim ran over its output was a second per 35 MB stage and now skips output with no `\r`.

## The cost of a native start

A builtin starts in under a millisecond. A native command in the app cost 22 to 30 ms on macOS, 21 ms in the Linux preview and 25 ms in the Windows preview, and the record has text tools inside loops often: `grep` in 222 loop bodies, `head` and `tr` in 139 each, `date` in 51, `stat` in 42, `wc` in 41, `tail` in 33, `cut` in 23, `sort` in 5. Measured per platform, with what each way of cutting it costs.

**macOS.** Of the 22 ms, about 5 is loading the binary (an unwrapped `coreutils true` takes 3 to 5 ms), 8 is starting `sandbox-exec`, 8 is compiling the 27 KB profile, and 3 is building it, before Node's own spawn.

| Way | Per start | What it costs |
| --- | --- | --- |
| `sandbox-exec -p` (today) | 18 ms bare, 21.6 ms in the shell | |
| Build the profile once per reach | saves 3 ms | none: a shell makes its reach once per call |
| Cached bytecode: compile once, `sbexec run <bytecode> <program>` | 4.2 ms bare, 6.3 ms in the shell | a 120-line C helper on libsandbox's private `sandbox_compile_string` and `sandbox_apply`, which Chromium also uses; built and signed with the Mac helper |
| A sandboxed spawner per chat (one process under the profile starting every command) | 3.4 ms bare | a long-lived process per chat, restarted on every rule change |

The cached-bytecode helper is on the branch behind `INSTRUMENT_SEATBELT_HELPER` (`scripts/seatbelt-exec/sbexec.c`): 50 native `sort` calls in one bash call went from 1,081 ms to 315 ms, and a refused path is still recovered exactly, since every command is still its own process under the full profile and its stderr is read the same way. Each set of rules compiles once (15 ms) and is held in memory; the bytecode reaches the helper in its arguments, because a file in the temp folder is writable by the sandboxed programs themselves and would let one command loosen the next one's sandbox. A rule change produces a new profile and so a new compile; nothing outlives it. The spawner would save another 0.8 ms at the cost of a process to keep alive and restart, and of the per-command attribution the decision proposes for refused paths (one profile tagged per run): every command would share the spawner's profile, so a refusal would have to be attributed by process id instead. Not worth it.

**Linux.** bubblewrap itself is cheap: 3.6 ms a call on the VM against 0.45 ms unwrapped, and a namespace kept alive would cut that to 0.5 ms. But the preview spent 21 ms a start, so most of it is the app's side: building the arguments, which includes the walk for names that run code (`.git/hooks`, `.envrc`; 9 to 13 ms by the sandbox's own measure), and Electron's spawn. A long-lived namespace is the weak option here: its binds are fixed when it starts, so a repository a command creates stays writable to the next one until it restarts, where today the next command finds it and binds its hooks read-only. The useful work is profiling the 17 ms on the app's side and caching what does not depend on the disk.

**Windows.** Creating any process costs about 7.5 ms there (`hostname.exe` and `coreutils.exe true` alike, signed or not). Node's `windowsHide`, which execa sets, doubles it to 14.7 ms, because each console program gets a hidden console of its own; Electron has no console, so a console child needs one either way. The preview's 25 ms leaves about 10 ms on the app's side. Achievable: 15 ms by profiling that, and about 8 ms only with a long-lived process that owns a console and starts the children, which buys little against its upkeep. There is no sandbox to compile.

With the macOS helper, a 20-iteration loop of a native command costs about 0.12 s more than the builtin, against 0.43 s today.

## The routing options

`shell-commands/native-text.ts` registers a command per route, after the builtins so it shadows them. Three ways to choose, scored on the macOS corpus run:

| | Corpus | Loops (extra per 20 iterations, today / with the helper) | macOS `find ~` and `grep -r ~` |
| --- | --- | --- | --- |
| **A.** Every command in the set always native, `find` and `tr` included | 229 of 245, but `find -newermt` fails | every one of the 710 loops in the record: 0.43 s / 0.12 s | hangs on the privacy dialogs |
| **B.** A fixed table: each command native or builtin, on every call | 229 of 245 | 559 loops natively (`tr` and `find` stay builtins): 0.43 s / 0.12 s | one rule: a recursive `grep` from the home folder runs the builtin |
| **C.** Builtin first, native when the builtin refuses an option, plus argument rules for `date`, `grep -r` and `find` | 223 of 245 | none on the common path | the same rule, for `find` and `grep` |

C loses six cases B passes because trying the builtin first keeps its silent divergences wherever it does not refuse outright (`wc` and `uniq` padding, `cut` on tabs, `date` formats), and it answers a command in a loop differently from the same command run once. Its one advantage was loop cost, which the helper cuts to 6 ms a start. So the branch takes **B**:

- **Native everywhere:** `sort`, `uniq`, `comm`, `join`, `cut`, `wc`, `head`, `tail`, `date`, `seq`, `od`, `sha256sum`, `md5sum`, `numfmt`, `realpath`, `shuf`, `dd`, `cmp`.
- **Native on macOS and Linux:** `stat` (uutils builds it for Unix only), `grep` (a recursive grep on Windows prints relative paths with backslashes), `xargs` (it starts programs from the PATH, and Windows has no `echo` or `printf`; `xargs -I{} echo` printed `Error: Command not found` in the Windows preview).
- **Builtins:** `find` (findutils 0.10.0 parses no `-newermt` date, prints backslashes on Windows, and its walks set off macOS's privacy dialogs, three conditions for a speedup `rg` already gives), `tr` (ties the builtin and runs in 139 loops), `diff`, `sed`, `awk`, `cat`, `ls`, `cp`, `mv`.

The one condition kept: on macOS a recursive `grep` whose start is the home folder or a folder holding it runs the builtin. It is clearly safe, since it falls back to today's behavior, and clearly worth it: the alternative is a native walk opening `~/Documents` and `~/Music`, macOS putting up its own Documents and Media Library dialogs naming the app, and the call waiting on them until it times out at two minutes. The Seatbelt profile already denies `~/Documents` and it still happened, so a profile deny does not get ahead of macOS's own check. Any native program walking there has the same exposure (`python -c 'os.walk(...)'`); `grep -r` is where a model does it without thinking. Getting it under 6 ms a start does not remove this condition, and it removes the reason for C.

On Windows, paths are respelled only where a routed command prints nothing but paths: `realpath`'s backslashes become slashes. `filterShellOutput` still respells only drive-absolute paths, so `a\nb` in a script's output is left alone, and `find` and `grep`, which would need more, stay builtins there.

## Refusals

Every uutils command names the path it was refused in the message's last `: ` segment, which `refusedPathIn` already reads: Seatbelt's refusals as `Operation not permitted` (`sort`, `grep`, `cmp`, `stat`) or `Permission denied` (`wc`, `cut`, `uniq`, `head`, `date`, `comm`), bubblewrap's closed folders as `No such file or directory` and the read-only home as `Read-only file system`. The prototype also checks each argument that names an existing path against the rules before it starts the program, the way `rg` does, so `sort ~/.ssh/known_hosts` raises the card for `~/.ssh` and names the file exactly as a builtin would. That removes the reason the decision gave for keeping path-taking commands builtins. The same held in the packaged previews: `sort ~/.bashrc` on Linux, `sort ~/AppData/Local/IconCache.db` on Windows and `sort ~/.ssh/known_hosts` through `run-bash` on macOS each named the file and raised the card for its folder before anything started. A recursive `grep` skips a refused file with no message and exits 1.

## Size and packaging

Studio vendors the release archives the way it vendors uv (`scripts/download-uutils.ts`, pinned by sha256, into `resources/uutils/`, inside `asarUnpack`), keeping only `coreutils`, `diffutils` (for `cmp`), and on macOS and Linux `grep` and `xargs`. afterPack checks each one is there and runs.

| Target | Installed | gzip (zip, tar.gz) | xz (NSIS, deb) |
| --- | --- | --- | --- |
| macOS arm64 | 18.9 MB | 8.5 MB | about 5.4 MB |
| Linux arm64 | about 17 MB | about 7.6 MB | about 4.6 MB |
| Windows x64 | 16.6 MB | 6.9 MB | 4.9 MB |
| Windows arm64 (coreutils only) | 10.8 MB | 4.9 MB | 3.4 MB |

x64 macOS and Linux are within a megabyte of their arm64 rows. For scale, uv is 40 MB installed. The Windows x64 coreutils zip is 67 MB because it carries 91 of its utilities as standalone `.exe` files beside the 14.6 MB multicall one; only the multicall binary is kept. Linux takes the musl build of coreutils and findutils, which run on any distribution; diffutils and grep publish glibc builds only, which need glibc 2.34. A multicall build of only the 32 utilities the shell could use is 8.4 MB against 12.7 MB on Linux arm64, about 4 MB a platform, at the cost of a Rust toolchain in CI.

The binaries run as `coreutils sort …` and `diffutils cmp …`, so nothing needs a link per name. Putting per-name links on every native command's PATH was rejected, since it would put GNU `stat` and `date` ahead of BSD's for every script and tool the agent runs on macOS.

macOS ships them inside the signed bundle like uv: electron-builder re-signs each Mach-O under `Resources` with the app's Developer ID and the hardened runtime (the upstream binaries are ad hoc, linker-signed), notarization accepts them, and Gatekeeper accepts the app as `Notarized Developer ID`. On Windows the build signs each `.exe` with the EV certificate.

## In the packaged app

Preview builds of the first prototype (builtin first, `find` native) for macOS arm64, Windows x64 and Linux arm64 and x64 built, passed afterPack's check, and were signed (and on macOS notarized). Installed on the macOS 27 VM, the Windows 11 PC and the Ubuntu 26.04 arm64 VM, a chat's own shell (`workspace.debug.runBash`, no model involved) named the bundled programs for `command -v sort cmp`, reported `sort (uutils coreutils) 0.12.0`, and answered `sort -g`, `uniq -c`, `cmp`, `grep -H`, `date -d '... +3 days'`, `realpath --relative-to`, `shuf`, `head -q` and UTF-8 through `sort | wc -c` as GNU does on all three; `xargs -I{}` on macOS and Linux. On Linux the program's process 1 was `bwrap` with the profile's mounts. The fixed table and the macOS helper have not been through a preview; Linux x64 and Windows on ARM were built but never run.

## An agent with and without them

`evals/cases/text-tools.ts` asks four questions of a folder of 40 site reports and two CSVs (the five highest turbidities, reports per inspector, reports with no Flags line, where a backup CSV differs). Three runs each, with the fixed table against builtins only (`EVAL_BUILTINS_ONLY=1`); builtins only still runs a host program by name, so on macOS `cmp` there is BSD's.

| | Passed | Calls turned down | Tool calls | Wall time | Tokens |
| --- | --- | --- | --- | --- | --- |
| GLM 5.3 Flash (Workers AI), uutils | 3 of 3 | 0 of 15 | 4, 6, 5 | 45, 115, 169 s | 101 to 125K |
| GLM 5.3 Flash, builtins | 3 of 3 | 2 of 18 (`grep -H`, `diff --changed-group-format`) | 6, 6, 6 | 226, 354, 188 s | 144 to 151K |
| Haiku 5.5 (OpenRouter), uutils | 3 of 3 | 0 of 12 | 5, 3, 4 | 22, 18, 25 s | 120 to 163K |
| Haiku 5.5, builtins | 3 of 3 | 0 of 12 | 3, 4, 5 | 13, 14, 16 s | 117 to 125K |

Both models answered correctly either way. GLM wrote two commands the builtins turned down and recovered from both, at a call and about 30K tokens a run; Haiku wrote none. Wall time on Workers AI is dominated by queuing, and three runs cannot separate the rest. The case measures that the routing costs nothing in answers; the benefit it buys shows in the record's 41 `sort -g` and 28 `grep -H` failures more than in one well-specified task. About $0.04 in all.

## What it retires

Little of the patch file. The `sort -h` part (#452) goes, since `sort` never reaches the builtin. The two `find` parts (#451, #555) and the `stat` part (#420) stay, for the builtin `find` and Windows' `stat`. In the known-gaps list it closes the `uniq -c` padding and non-ASCII `sort` order, and `dd`, `realpath` and `shuf` among the missing commands. The larger saving is the patches not yet written: `sort -g`, `grep -H`/`-P`, `xargs -I`/`-n`, `head -q`, `cut --complement` and `cmp` would each have been an upstream pull request and a local diff.

## brush, again

The decision ruled brush out on three counts: its commands are uutils processes, it reads the real filesystem so only an OS sandbox can hold it, and it embeds from Rust only, with Windows in preview. The first is now what this page proposes, and the second is how native commands are already held. What is left:

- **Hosting our commands.** brush-core has custom builtins written in Rust, and since 2026-10-15 (#1508, on `main`, after the 0.4.0 release) a `ProcessLauncher` the host supplies: every external command goes through it, so a host can start them under its own sandbox or answer them without a process at all. `task`, `chat`, `app`, `memory`, `tab`, `jobs`/`fg`/`kill`, the `agent-browser` wrapper and the rule checks would become a sidecar: a Rust binary embedding brush-core whose launcher sends those names to Node over a socket and streams their output back. A command answered that way has no process id, so `$!`, `kill` and job control do not reach it. There is no Node binding.
- **Pipelines.** Real OS pipes. On the Ubuntu VM the 34 MB `sort | uniq -c | wc -l` took 0.83 s under brush 0.4.0 against 0.71 s under bash and 3.8 s under just-bash; `yes | head -3` ends, which no just-bash pipeline can; 50 starts in a loop took 33 ms. Arrays, `[[ =~ ]]`, `local`, here-docs and `printf` answered as bash does. `brush-coreutils-builtins` can also compile uutils in as builtins, with no process per command at all.
- **Windows.** Still preview: built and statically checked in CI with a small test suite, no prebuilt binaries, and "functional for basic usage". On Windows a real shell's redirections, globs and `cd` touch the disk directly, where today `rulesFs` holds every builtin to the rules in-process; with no OS sandbox there, Windows would lose its only enforcement for everything but the commands the launcher hands to Node.

It deserves a spike for macOS and Linux, where the OS sandbox already holds every native command and brush running under the same profile would hold its own redirections too: build the sidecar with a launcher that wraps each command in the cached Seatbelt bytecode or bubblewrap and forwards our commands to Node, and run the agent's shell through it behind a flag. Not before `ProcessLauncher` is in a release, and not for Windows until it has a sandbox ([windows-sandbox.md](../architecture/windows-sandbox.md)), so two shells would ship for a while.

## What would change it

- findutils fixing `-newermt` and Windows separators: `find` joins the table and the `find` patches go.
- Streaming pipelines in just-bash (#453), adjacent native stages run as one OS pipeline, or brush: the pipeline row above becomes the terminal's.
- uutils sed's next release with `-z`: worth scoring against the builtin again.
