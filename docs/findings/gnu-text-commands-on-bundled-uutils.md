# GNU text commands on bundled uutils

**Status:** open, measured 2026-10-15; a prototype routes the commands below and waits on a decision to ship it.

[The shell stays just-bash](../decisions/2026-10-12-the-shell-stays-just-bash-and-real-programs-do-the-rest.md) parked native text commands for two reasons: macOS ships BSD tools while models write GNU flags, and Windows has no coreutils. uutils removes both. It is the MIT-licensed Rust reimplementation of GNU coreutils (findutils, diffutils and grep beside it), prebuilt for every target Studio ships, and Ubuntu 26.04 already uses it as its default `coreutils`. This page records what bundling it buys and costs, and the routing the prototype settled on.

## Compatibility

The corpus is 245 argv-level cases mined from 21,313 recorded agent `bash` calls (production and evals): the most frequent invocations of `sort`, `uniq`, `cut`, `wc`, `tr`, `comm`, `join`, `find`, `xargs`, `grep`, `diff`, `date` and `stat`, every flag that failed in the record (`sort -g` 41 times in 37 sessions, `grep -H` 28 in 22, `grep -P`, `xargs -I{}`/`-n1`, `head -q`), the missing commands (`cmp` 22 times, `realpath`, `shuf`, `dd`), the BSD spellings (`stat -f` 217 times in 5 sessions, `date -j -f`, `ls -lT`), and a few `sed` and `awk` shapes. Each case runs with no shell (argv, stdin from a file, `TZ=UTC`, `LC_ALL=C.UTF-8`) against GNU coreutils 9.7, findutils 4.10, diffutils 3.12, grep 3.12 and gawk 5.3 on Ubuntu as the reference. A case passes when stdout and success match. The Windows column counts a path printed with backslashes as a pass, to show what the tools compute; as printed, Windows passes 188, since `filterShellOutput` respells only drive-absolute paths and `find`, `grep -r` and `realpath` print relative ones (`reports\b.md`).

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
- diffutils 0.5.0 has no `-r`, `-w`, `-i` or `-y`, and prints `4a5,5` where GNU prints `4a5`. Its `cmp` is right.
- uutils sed 0.1.1 misses `0,/re/` and `-z`. No permissive awk matches gawk: goawk lacks `gensub` and `IGNORECASE` and fails to lex `[^/]` inside a regex, the same bug as the builtin.
- `xxd` is not part of coreutils; `od -An -tx1` covers it.
- ugrep 7.5, which Claude Code uses for `grep`, failed three cases uutils grep 0.2.0 passes (it drops the `./` of a walk from `.`, and refuses `\?` under `-a`), and ships prebuilt only for Windows.

The builtins diverge silently as well as loudly: `sort -n` reads `1e3` as a thousand, `uniq -c` pads to four columns, `sort` collates non-ASCII lines in neither GNU's `C` nor its UTF-8 order, `date` prints `%-d` literally, `sort -o` writes nothing, and `tr '\0' ' '` replaces the digit `0` rather than NUL.

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
| one `sort -n` of a small file | 0.7 ms | 27 ms | 5 ms |

A walk is where native wins outright. Large data crossing a pipeline gains little, because each stage's whole output is collected as a string, handed to the interpreter, and encoded again for the next stage: native stages pay the marshaling the builtins pay plus their own. The carriage-return collapse every native shim ran over its output was a second per 35 MB stage and now skips output with no `\r`.

Spawn cost is the price of correctness on small inputs. A native start costs 25 to 30 ms in the app on macOS against about 1 ms for a builtin: 5 ms to load the 14 MB multicall binary, 8 more for `sandbox-exec` to start, 8 more to compile the 27 KB profile, 3 to build it, and the rest in `execa`. Under bubblewrap on the Ubuntu VM a bare start costs 10 ms against 2 ms unwrapped. In the packaged previews, 20 `sort` calls in a loop took 21 ms each on the Linux VM, 22 ms on the macOS VM, and 25 ms on a Windows PC with no sandbox at all; 20 builtin `tr` calls took 23 ms in total on the Linux VM. A loop of 50 `sort` calls takes 1.4 s natively where the builtin takes 36 ms, and the record has `grep` inside 222 loops, `tr` in 139, `date` in 51 and `wc` in 41.

## Refusals

Every uutils command names the path it was refused in the message's last `: ` segment, which `refusedPathIn` already reads: Seatbelt's refusals as `Operation not permitted` (`sort`, `grep`, `cmp`, `stat`) or `Permission denied` (`wc`, `cut`, `uniq`, `head`, `date`, `comm`), bubblewrap's closed folders as `No such file or directory` and the read-only home as `Read-only file system`. The prototype also checks each argument that names an existing path against the rules before it starts the program, the way `rg` does, so `sort ~/.ssh/known_hosts` raises the card for `~/.ssh` and names the file exactly as a builtin would. That removes the reason the decision gave for keeping path-taking commands builtins. The same held in the packaged previews: `sort ~/.bashrc` on Linux, `sort ~/AppData/Local/IconCache.db` on Windows and `sort ~/.ssh/known_hosts` through `run-bash` on macOS each named the file and raised the card for its folder before anything started.

A walk is different on macOS. Seatbelt does not stop a native read of the folders macOS itself guards, so a native `find ~` opened `~/Documents` and `~/Music`, macOS put up its own Documents and Media Library dialogs naming the app, and the walk waited on them until the call timed out at two minutes. The builtin asks the rules before it opens a folder and never opens one they keep for asking, so it raises none. A `find` or recursive `grep` starting at the home folder or above it therefore stays the builtin's on macOS. Any native program walking there has the same exposure (`python -c 'os.walk(...)'`); the text commands are where a model would do it without thinking.

What a walk passes is the sandbox's: `find` prints one `Error: <path>: Operation not permitted (os error 1)` per closed folder, dozens over the home folder, which the prototype folds into one line saying how many it left out. `grep -r` skips a refused file with no message at all and exits 1.

## Size and packaging

Studio vendors the release archives the way it vendors uv (`scripts/download-uutils.ts`, pinned by sha256, into `resources/uutils/`, inside `asarUnpack`), keeping only `coreutils`, `find`, `xargs`, `diffutils` and `grep`. afterPack checks each one is there and runs.

| Target | Installed | gzip (zip, tar.gz) | xz (NSIS, deb) |
| --- | --- | --- | --- |
| macOS arm64 | 20.6 MB | 9.1 MB | 5.7 MB |
| macOS x64 | about 20.5 MB | about 8.5 MB | about 5.6 MB |
| Linux arm64 | 19.1 MB | 8.2 MB | 5.0 MB |
| Linux x64 | about 22 MB | about 8.7 MB | about 5.9 MB |
| Windows x64 | 20.9 MB | 8.6 MB | 5.7 MB |
| Windows arm64 (coreutils only) | 10.3 MB | 4.7 MB | 3.2 MB |

For scale, uv is 40 MB installed. The Windows x64 coreutils zip is 67 MB because it carries 91 of its utilities as standalone `.exe` files (4 MB each for the checksum tools) beside the 14.6 MB multicall one; only the multicall binary is kept. The x86_64 Linux glibc archive is 15 MB because it also ships `uudoc`. Linux takes the musl builds of coreutils and findutils, which run on any distribution; diffutils and grep publish glibc builds only, which need glibc 2.34. A multicall build of only the 32 utilities the shell could use is 8.4 MB against 12.7 MB on Linux arm64, which would save about 4 MB a platform at the cost of a Rust toolchain in CI.

The binaries run as `coreutils sort …` and `diffutils cmp …`, so nothing needs a link per name. Links matter only for programs that `xargs` and `find -exec` start, which resolve on the PATH: on macOS that is the BSD tool, and on Windows nothing unless a directory of per-name hardlinks is put ahead on the PATH for those two commands alone. Putting the links on every native command's PATH was rejected, since it would put GNU `stat` and `date` ahead of BSD's for every script and tool the agent runs on macOS.

macOS ships them inside the signed bundle like uv: electron-builder re-signs each Mach-O under `Resources` with the app's Developer ID and the hardened runtime (the upstream binaries are ad hoc, linker-signed), notarization accepts them, and Gatekeeper accepts the app as `Notarized Developer ID`. On Windows the build signs each `.exe` with the EV certificate, ten more signing calls per build.

## The routing the prototype settled on

`shell-commands/native-text.ts` registers a command per route, after the builtins so it shadows them.

- **Always uutils:** `sort`, `uniq`, `comm`, `join`, `od`, and the commands with no builtin, `cmp`, `realpath`, `shuf`, `dd`, `numfmt`. `find` on macOS and Linux, except a `find` naming `-newermt`, and on macOS one starting at the home folder or above it.
- **Builtin first, uutils when it refuses an option or the call needs it:** `grep` (native for `-r` on macOS and Linux, except over the home folder on macOS), `date` (relative dates, `-r`, `%-d`), `cut`, `wc`, `head`, `tail`, `seq`, `sha256sum`, `md5sum`, and on macOS and Linux `stat` and `xargs`. These are the commands models run in loops, where a start per iteration costs more than the builtin's divergences do.
- **Builtins:** `diff`, `sed`, `awk`, `tr`, `cat`, `ls`, `cp`, `mv`, and everything else.

Windows narrows it because uutils' `xargs` starts what it runs from the PATH, where Windows has no `echo` or `printf` (`xargs -I{} echo` printed `Error: Command not found` in the preview), and because a recursive `grep` prints relative paths with backslashes. `realpath` prints nothing but paths, so its backslashes become slashes there.

## In the packaged app

Preview builds of the prototype for macOS arm64, Windows x64 and Linux arm64 and x64 built, passed afterPack's check that each binary is there and runs, and were signed (and on macOS notarized). Installed on the macOS 27 VM, the Windows 11 PC and the Ubuntu 26.04 arm64 VM, a chat's own shell (`workspace.debug.runBash`, no model involved) named the bundled programs for `command -v sort cmp find`, reported `sort (uutils coreutils) 0.12.0`, and answered `sort -g`, `uniq -c`, `cmp`, `grep -H`, `date -d '... +3 days'`, `realpath --relative-to`, `shuf`, `head -q` and UTF-8 through `sort | wc -c` as GNU does on all three; `xargs -I{}` on macOS and Linux. On Linux the program's process 1 was `bwrap` with the profile's mounts, so bubblewrap wraps them as it wraps any native command. Linux x64 and Windows on ARM were built or vendored but not run.

Without `uutilsDir` every command stays the builtin. A native text command is an ordinary native command to the rest of the shell: it streams to a background job's live view, is stopped by cancellation, and is held by Seatbelt or bubblewrap.

## What it retires

Little of the patch file. The `sort -h` part (#452) goes, since `sort` never reaches the builtin. The two `find` parts (#451, #555) stay while Windows and `-newermt` reach the builtin `find`, and the `stat` part (#420) stays because `stat` tries the builtin first. In the known-gaps list it closes the `uniq -c` padding and non-ASCII `sort` order, and `dd`, `realpath` and `shuf` among the missing commands. The larger saving is the patches not yet written: `sort -g`, `grep -H`/`-P`, `xargs -I`/`-n`, `head -q`, `cut --complement` and `cmp` would each have been an upstream pull request and a local diff.

## Toward a real shell

uutils is half of what leaving just-bash would need: brush, the full bash the decision weighed, runs exactly these programs for `ls`, `grep`, `sed` and `awk`. Two things measured here point the same way. Pipelines of native stages lose most of their speed to the interpreter collecting every stage (`sort | uniq -c | wc -l` is 0.56 s in a terminal and 3.8 s through just-bash); a real shell connects them with OS pipes. And the start cost is per process wherever the shell lives. What still holds the decision is Windows, where a real shell's commands would run with no sandbox and no rules check at all, and the builtins are what apply the rules there.

## What would change it

- findutils fixing `-newermt` and Windows separators: `find` goes native everywhere and the `find` patches go.
- A cheaper sandboxed start (a persistent launcher, or a profile compiled once per call rather than per process) makes the builtin-first routes unnecessary.
- Streaming pipelines in just-bash (#453), or adjacent native stages run as one OS pipeline, would turn the pipeline column above into the terminal's.
