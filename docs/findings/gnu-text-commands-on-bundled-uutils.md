# GNU text commands on bundled uutils

**Status:** resolved, measured 2026-10-15: the GNU text commands answer from bundled uutils by a fixed table ([native-and-builtin-commands.md](../architecture/native-and-builtin-commands.md) has the table as it runs), native commands start through the Seatbelt launcher, and the Photos, Music and TV libraries are places. Re-score with the corpus below after a uutils release.

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
| Cached bytecode: compile once, `instrument-seatbelt run <bytecode> <program>` | 4.2 ms bare, 6.3 ms in the shell | a 120-line C helper on libsandbox's private `sandbox_compile_string` and `sandbox_apply`, which Chromium also uses; built and signed with the Mac helper |
| A sandboxed spawner per chat (one process under the profile starting every command) | 3.4 ms bare | a long-lived process per chat, restarted on every rule change |

The cached-bytecode helper ships as `instrument-seatbelt` (`apps/studio/native/mac-helper/seatbelt`), the default for every native start on macOS; measured as a prototype, 50 native `sort` calls in one bash call went from 1,081 ms to 315 ms, and a refused path is still recovered exactly, since every command is still its own process under the full profile and its stderr is read the same way. Each set of rules compiles once (15 ms) and is held in memory; the bytecode reaches the helper in its arguments, because a file in the temp folder is writable by the sandboxed programs themselves and would let one command loosen the next one's sandbox. A rule change produces a new profile and so a new compile; nothing outlives it. The spawner would save another 0.8 ms at the cost of a process to keep alive and restart, and of the per-command attribution the decision proposes for refused paths (one profile tagged per run): every command would share the spawner's profile, so a refusal would have to be attributed by process id instead. Not worth it.

**Linux.** bubblewrap itself is cheap: 3.6 ms a call on the VM against 0.45 ms unwrapped, and a namespace kept alive would cut that to 0.5 ms. But the preview spent 21 ms a start, so most of it is the app's side: building the arguments, which includes the walk for names that run code (`.git/hooks`, `.envrc`; 9 to 13 ms by the sandbox's own measure), and Electron's spawn. A long-lived namespace is the weak option here: its binds are fixed when it starts, so a repository a command creates stays writable to the next one until it restarts, where today the next command finds it and binds its hooks read-only. The useful work is profiling the 17 ms on the app's side and caching what does not depend on the disk.

**Windows.** Creating any process costs about 7.5 ms there (`hostname.exe` and `coreutils.exe true` alike, signed or not). Node's `windowsHide`, which execa sets, doubles it to 14.7 ms, because each console program gets a hidden console of its own; Electron has no console, so a console child needs one either way. The preview's 25 ms leaves about 10 ms on the app's side. Achievable: 15 ms by profiling that, and about 8 ms only with a long-lived process that owns a console and starts the children, which buys little against its upkeep. There is no sandbox to compile.

With the macOS helper, a 20-iteration loop of a native command costs about 0.12 s more than the builtin, against 0.43 s today.

## The routing options

`shell-commands/native-text.ts` registers a command per route, after the builtins so it shadows them. Three ways to choose, scored on the macOS corpus run:

| | Corpus | Loops (extra per 20 iterations, today / with the helper) | macOS `find ~` and `grep -r ~` |
| --- | --- | --- | --- |
| **A.** Every command in the set always native, `find` and `tr` included | 229 of 245, but `find -newermt` fails | every one of the 710 loops in the record: 0.43 s / 0.12 s | no dialog once the media libraries are closed, but uutils `find -prune` opens what it prunes |
| **B.** A fixed table: each command native or builtin, on every call | 229 of 245 | 571 loops natively (`tr` stays a builtin): 0.43 s / 0.12 s | none, once the Music, TV and Photos libraries are closed (below) |
| **C.** Builtin first, native when the builtin refuses an option, plus argument rules for `date`, `grep -r` and `find` | 223 of 245 | none on the common path | an argument rule for `find` and `grep` |

C loses six cases B passes because trying the builtin first keeps its silent divergences wherever it does not refuse outright (`wc` and `uniq` padding, `cut` on tabs, `date` formats), and it answers a command in a loop differently from the same command run once. Its one advantage was loop cost, which the helper cuts to 6 ms a start. So the branch takes **B**:

- **Native everywhere:** `sort`, `uniq`, `comm`, `join`, `cut`, `wc`, `head`, `tail`, `date`, `seq`, `od`, `sha256sum`, `md5sum`, `numfmt`, `realpath`, `shuf`, `dd`, `cmp`, and `xargs`. xargs starts its programs from the PATH, and Windows has no `echo` or `printf` (`xargs -I{} echo` printed `Error: Command not found` in the Windows preview), so there its PATH starts with a folder of hard links to the coreutils binary, one per utility, leaving out `expand`, `hostname`, `more`, `timeout` and `whoami`, which System32 also has.
- **Native on macOS and Linux:** `find` (below), `stat` (uutils builds it for Unix only), `grep` (a recursive grep on Windows prints relative paths with backslashes).
- **Builtins:** `tr` (ties the builtin and runs in 139 loops), `diff`, `sed`, `awk`, `cat`, `ls`, `cp`, `mv`.

There is no condition left. An earlier version of the table sent a recursive `grep` from the home folder to the builtin on macOS, to stop macOS's privacy dialogs; [the next section](#macos-privacy-dialogs) found their cause and closed it in the rules, and a 6 ms start removed the reason for C.

On Windows every argument reaches uutils quoted, since it expands `*`, `?` and `[...]` in an unquoted one (`cut -d '*'` failed, `echo '*.md'` printed file names). Paths are respelled only where a routed command prints nothing but paths: `realpath`'s backslashes become slashes. `filterShellOutput` still respells only drive-absolute paths, so `a\nb` in a script's output is left alone, and `find` and `grep`, which would need more, stay builtins there.

## macOS privacy dialogs

A native `find ~` on macOS once hung for two minutes on macOS's own dialogs naming the app. Traced on the macOS 27 VM with tccd's log (`AUTHREQ_CTX`, `AUTHREQ_ATTRIBUTION`, `AUTHREQ_PROMPTING`), each command run in a chat of a notarized preview, the app as the responsible process:

- **The Documents dialog was the app, not the walk.** It came two seconds after launch, attributed to the app's main process opening its output folder, before any command ran. A person answers it once at first launch; most will allow it, since the output folder lives there.
- **The Seatbelt profile is consulted before macOS's check.** A native `ls ~/Documents`, which the profile denies, failed with `Operation not permitted` and tccd logged no request at all, while the app's own Documents question was still open on screen.
- **The walk's dialog came from a path no rule held.** A native `find ~ -maxdepth 2` asked for Full Disk Access (denied, no prompt), Photos (refused with `Policy disallows prompt`, since the app declares no Photos usage), and Media Library twice, the second time with a dialog. Narrowed by hand: listing `~/Music`, `~/Movies` or `~/Pictures` asks Media Library and gets an answer with no dialog; listing `~/Movies/TV`, the TV and Music apps' library, puts the dialog up. The walk waited 51.7 s, until it was answered.

So a dialog appears only where the rules leave a path open to native programs and the app holds no answer from macOS for its service: never where the rules deny or ask, since the profile refuses first, and never where the person already granted the app the folder. Today that leaves the media libraries. Desktop, Documents, Downloads, iCloud Drive, `/Volumes` and `~/Library` (other apps' data, Mail, Messages, the keychain) are places the rules ask about or keep closed, so the profile denies them.

Ways to stop it, each tried:

| Way | Result |
| --- | --- |
| Close the libraries in the rules (two places, the Photos library and the Music and TV libraries: `~/Music/Music`, `~/Music/iTunes`, `~/Movies/TV`) | No dialog: in the rebuilt preview `ls ~/Movies/TV` was refused by the sandbox and raised the card for that folder, a native `grep -r` over the whole home folder finished in 197 ms, and macOS's own `find ~ -maxdepth 4` in 48 ms, each with no dialog. On the branch |
| Disclaim responsibility (`responsibility_spawnattrs_setdisclaim`), so macOS treats the program as its own responsible process | No dialog, because a command-line program has none to show: the read is refused silently. But it also loses every grant the person gave Instrument: a disclaimed `ls ~/Documents/Instrument` was refused where the plain one read it. Not usable |
| Prune the libraries from the walk (`find ~ -path ~/Movies/TV -prune`) | macOS's `find` honors it and asks nothing; uutils `find` 0.10.0 opens the folder before `-prune` applies and the dialog came anyway. `stat` of the folder itself asks nothing |
| A second Seatbelt profile from inside the sandbox | Refused: `sandbox_apply` in an already sandboxed process fails with `Operation not permitted` |

Closing the libraries holds for every native program, `python`'s `os.walk` included, and asks the person the same way any other closed folder does. What it does not cover is a TCC-guarded path outside those names (a Photos library saved under another name, a second Music library on an external drive under `/Volumes`, which asks anyway); one of those would put a dialog up the way `~/Movies/TV` did, and the fix is the same line in the place.

## find

`find` is the walk models reach for even with `rg` in the bash description: in the record, 311 `find` calls in 129 app sessions against 529 `rg` in 120, and 627 against 2,084 in the evals; 29 of the `find` calls start at the home folder. It runs uutils on every platform, on Windows with the separator patch the architecture page describes.

- **Answers.** On the corpus the builtin misses `-type f` from `.`, `-printf` with `%TY-%Tm-%Td`, `-prune`, `-L` and `-type f,d`; uutils misses only `-newermt` with a time, which the builtin misses as well. The table passes 229 of 245 with `find` native against 224 with the builtin, `find`'s own cases 23 of 24 against 18, on the macOS and the Linux runs alike.
- **Speed.** just-bash#597 (carried on the records branch as `mountable-dirents-3.6.0.diff`) reads each folder once rather than once per entry, which brings the builtin's 21,000-file `find -type f` to 135 ms on macOS (from 734) and 383 ms on Windows (from 8,423); uutils took 63 ms over 20,000 files through the shell. With the launcher a native start costs about 6 ms, so a native `find` is never the slower of the two. The builtin also stops at 20,000 entries over the home folder and 300,000 in all.
- **Privacy dialogs.** uutils' `-prune` opens the pruned folder before skipping it, which set off macOS's Media Library dialog over `~/Movies/TV`. With the media libraries closed as places the sandbox refuses that open first: in a notarized preview, `find ~/Movies -path ~/Movies/TV -prune -o -print` and `find ~ -maxdepth 3` ran with no dialog and no request to macOS beyond the ones it answers silently.
- **What the app hides.** Nothing, once the chat records moved out of the chat's folder: the workspace's `.instrument` is closed by the rules, which the sandbox enforces for `find` as for any program, so `find` gets no prune and only its start points are held to the rules as paths. Hiding it had been tidiness rather than a boundary; the sandbox protected the folder either way.
- **Windows** first kept the builtin: uutils printed backslashes there, which `-path '*/.*'` and `-prune` written with slashes never match. The uutils-build patch read through `UUTILS_PATH_SEPARATOR=slash` fixed that, and `find` joined the Windows column (`4c0331dae`).
- **`-newermt`.** findutils 0.10.0 parses no date; `main` parses ISO dates since 2026-08-20, unreleased, reading them as UTC where GNU reads local time.

## The commands both have

The first corpus left out thirteen commands both just-bash and uutils carry, so they had stayed builtins by default. A second corpus of 142 cases scores them the same way (argv, stdin from a file, `TZ=UTC`, `LC_ALL=C.UTF-8`, stdout and success against GNU), with GNU coreutils 9.12 as the reference, run as Homebrew's `g`-prefixed build on macOS; `split` and `mktemp` cases also compare the files they leave, by name and content, with the random part of a `mktemp` name masked. The record has few of these calls, so the shapes it does have are all in: `base64 -w0`, `base64 -w 0` and BSD's `base64 -i file`, `nl -ba`, `basename "$f" .pdf`, `dirname "$f"`, `readlink link`, `paste -sd,` and `mktemp -d`. The builtin was scored through the agent's shell (`run-bash`), uutils 0.12.0 directly on macOS arm64 and Windows x64, and again through the shell on macOS once routed. On Windows the routed shell printed `readlink -f`, `basename` and `dirname` paths the way the shell spells them (`/c/Users/...`), split into a subfolder, round-tripped binary through `base64 -d` to a file, and raised the card for a split into `/c/Windows`. Linux was not run; it is the same source, and scored within two cases of macOS in the first corpus.

| | builtin | uutils macOS | uutils Windows | macOS's BSD tools |
| --- | --- | --- | --- | --- |
| all 142 | 106 | 141 | 140 | 86 of 125 |
| `sha1sum` (9) | 6 | 9 | 9 | none |
| `base64` (14) | 11 | 13 | 13 | 5 |
| `paste` (14) | 11 | 14 | 14 | 11 |
| `nl` (11) | 9 | 11 | 11 | 8 |
| `fold` (9) | 8 | 9 | 9 | 8 |
| `tac` (8) | 4 | 8 | 8 | none |
| `split` (13) | 8 | 13 | 13 | 7 |
| `readlink` (15) | 10 | 15 | 15 | 12 |
| `mktemp` (11) | 11 | 11 | 10 | 4 |
| `basename` (14) | 10 | 14 | 14 | 11 |
| `dirname` (10) | 8 | 10 | 10 | 9 |
| `expand` (8) | 6 | 8 | 8 | 6 |
| `unexpand` (6) | 4 | 6 | 6 | 5 |

Through the shell after routing, macOS answers 141, the same as uutils run directly. The Windows column counts relative paths printed with backslashes as the shell prints them, with slashes. uutils' one miss everywhere is `base64 -D`, BSD's spelling of decode, which uutils accepts and GNU refuses; that only helps a model that learned BSD flags.

What the builtins get wrong, by command:

- `sha1sum` refuses `--tag`, and prints its warnings and missing-file errors on stdout.
- `base64` refuses `-i` (`--ignore-garbage`, and the `base64 -i file` models write from BSD) and decodes `@@@notbase64` to bytes with status 0, where GNU reports invalid input.
- `paste` reads no stdin without a `-`, and takes `\n` and `\t` in `-d` literally.
- `nl` pads an unnumbered line with a tab where GNU pads with a space, and refuses `-b pREGEX`.
- `fold` counts a tab as fewer columns than GNU does, so it breaks lines after one elsewhere.
- `tac` reads only its first file, refuses `-s` and `-b`, and adds a newline to a last line that has none.
- `split` refuses `-C`, `-n l/N`, `--lines=` and `--numeric-suffixes=`, and divides `-n 3` at other byte offsets.
- `readlink` follows a whole chain without `-f`, keeps the link's name inside a `-f` path (`dir.link/f.txt`), answers `-f` with a missing parent, and refuses `-m` and `-n`.
- `basename /` and `dirname /` print an empty line and `.`, so a loop climbing with `dirname` until `/` never ends; `basename .txt .txt` prints nothing, `-z` ends with a newline, and a third operand is accepted.
- `expand` keeps repeating the last interval of a tab list (`-t 2,6`) where GNU puts one space, and refuses `-4`; `unexpand -t 4` converts only leading blanks, where GNU's `-t` implies `-a`, and refuses `--first-only`.

So twelve are routed on every platform (the table in [native-and-builtin-commands.md](../architecture/native-and-builtin-commands.md)), and `mktemp` stays the builtin: it ties on every case, `$TMPDIR` and `-p` included, so a native start buys nothing there, and on Windows uutils drops the `/` before the X's of `mktemp out/XXXXXX`, creating `outA1b2C3` in the working folder. `split` holds its prefix to the rules as a write before it starts, so a split into a closed folder raises the card; `basename` and `dirname` hold no operand to the rules, since they never open one. `sha1sum`, `base64`, `basename` and `dirname` joined the unsandboxed tier A rules, read against the 0.12.0 sources (sha1sum is sha256sum's front end, base64 base32's, and the other two open nothing); the rest run sandboxed.

The cost is the loop one `tr` stayed for. A native `basename` in a 20-iteration loop took 130 ms through the shell on macOS against about 16 ms for a builtin command (`mktemp -u`), and 410 ms on Windows; Linux, at about 21 ms a start, lands near Windows. The record has `basename "$f"` and `dirname "$f"` in loops, so this is paid where they are used most, in exchange for the edge cases above.

## Going further

**The helper serves every native command, not only uutils.** It sits in `wrapNativeCommand`, so `python`, `node`, `rg`, `git` and a program on the PATH start through it too. In the shell on the M5 Max:

| 20 starts of | sandbox-exec | Cached bytecode |
| --- | --- | --- |
| `rg --version` | 430 ms | 134 ms |
| `git --version` | 425 ms | 121 ms |
| `node -e 0` | 877 ms | 509 ms |
| `sort /dev/null` | 449 ms | 138 ms |

In the rebuilt preview on the macOS VM, a notarized app launched with the helper set, 20 native `sort` starts took 135 ms, 6.75 ms each, against 22 ms before. Built into the app as `instrument-seatbelt` (signed with the app's Developer ID and the hardened runtime, checked in afterPack), 20 native `cat` starts took 172 ms on the VM; the same app with the launcher removed fell back to sandbox-exec and took 483 ms, with the same refusals.

**Linux.** Building the bubblewrap arguments, the walk for names that run code included, takes 1.4 to 1.9 ms on the M5 Max with a whole repository granted; bubblewrap itself 3.6 ms on the VM. The preview's 21 ms a start is therefore mostly something not yet measured on Linux (Electron's spawn and the per-command environment, on a slow VM); profiling a dev build there with `--cpu-prof` is the next step. A namespace kept alive saves the 3.6 ms and weakens the code-name binds, so it is not the lever.

**Windows.** The 25 ms a start was measured inside the preview through CDP; the 7.5 ms process creation and the 14.7 ms with `windowsHide` were taken over SSH, a non-interactive logon session, and need repeating in the interactive one before anyone builds on them. Once Windows has a sandbox, MXC costs about 45 ms a spawn on top, roughly 70 ms a native command, which argues for keeping Windows' column short.

**More commands.** Outside the table the corpus finds little: `tr` passes either way except `tr '\0'`, which the builtin gets wrong; `touch` would fix the builtin discarding `-t` and `-r` (#364), but it writes every operand, so each needs the write check; `printf` is the interpreter's own and cannot be shadowed. `ls` once stayed a builtin so the entries the app hides stay hidden; nothing is hidden any more, so what keeps it is loop cost and unscored `ls -l` output. The commands both just-bash and uutils have that models write less often are scored [above](#the-commands-both-have). At 6 ms a start `tr` could join at a cost of about 0.12 s per 20-iteration loop; on Linux, until its start cost moves, 0.4 s.

## One name, one implementation

Shipping the builtin, the system's tool and uutils side by side under distinct names, for the agent to choose from, would add names nothing in the record uses. Across 21,313 calls no model wrote `gsort`, `gdate`, `gawk`, `gsed`, `ggrep`, `/usr/bin/sort` or a `--version` probe of a text tool, and only three calls asked `which` or `command -v` about one, each a survey of the environment. After a refused option the next call was the same tool with other flags 50 times, `awk` or `perl` 31, Python 11, something else 16, and another build of the same tool by name never. Models write GNU flags against the name they know; the name should answer GNU.

## The private API

The helper calls `sandbox_compile_string` and `sandbox_apply`, which no header declares.

- **Notarization** checks the signature, the hardened runtime and a malware scan; it does not look for private symbols. App Store review does, and Instrument does not ship there.
- **Chromium** declares the same pair, with the same three-field `sandbox_profile_t`, in `sandbox/mac/seatbelt.cc` (`Seatbelt::Compile`, `ApplyCompiledProfile`), and its `SandboxSerializer` has a compiled target: the browser compiles a profile and the child applies the bytes. Every Chrome on a Mac relies on the call staying put.
- **Codex** runs `/usr/bin/sandbox-exec -p <profile>` for each command and caches nothing; Apple marks `sandbox-exec` deprecated in its man page, as it marked `sandbox_init` deprecated in 10.8 with no replacement, and both still ship.
- **The bytecode format** is never stored or shipped: each set of rules is compiled on the person's Mac, by its own libsandbox, when first used, and held in memory for the launch. A new macOS that changed the format would change the compiler with it.
- **The fallback** is in place: a helper that fails to compile, or is absent, leaves `wrapNativeCommand` on `sandbox-exec`, which is what runs today. A `sandbox_apply` that failed would exit 126 rather than run unsandboxed.
- **Could one change break both?** Yes, if Apple withdrew process-applied Seatbelt profiles altogether: `sandbox-exec` is itself a thin caller of the same library. That would also take Chrome's renderer sandbox and every agent CLI's with it, so it would come with a replacement and notice; the helper adds no exposure there that `sandbox-exec` does not already have.

## Refusals

Every uutils command names the path it was refused in the message's last `: ` segment, which the agent reads as printed (nothing parses it; the agent asks with `ask_permission`): Seatbelt's refusals as `Operation not permitted` (`sort`, `grep`, `cmp`, `stat`) or `Permission denied` (`wc`, `cut`, `uniq`, `head`, `date`, `comm`), bubblewrap's closed folders as `No such file or directory` and the read-only home as `Read-only file system`. The prototype also checks each argument that names an existing path against the rules before it starts the program, the way `rg` does, so `sort ~/.ssh/known_hosts` raises the card for `~/.ssh` and names the file exactly as a builtin would. That removes the reason the decision gave for keeping path-taking commands builtins. The same held in the packaged previews: `sort ~/.bashrc` on Linux, `sort ~/AppData/Local/IconCache.db` on Windows and `sort ~/.ssh/known_hosts` through `run-bash` on macOS each named the file and raised the card for its folder before anything started. A recursive `grep` prints GNU's `grep: <path>: Operation not permitted` for each file it is refused on the way, as GNU grep does; `-s` silences them.

## Size and packaging

Studio vendors the release archives the way it vendors uv (`apps/studio/scripts/download-uutils.ts`, pinned by sha256, into `resources/uutils/`, inside `asarUnpack`), keeping only `coreutils`, `diffutils` (for `cmp`), and on macOS and Linux `grep` and `xargs`. afterPack checks each one is there and runs.

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

Preview builds of the first prototype (builtin first, `find` native) for macOS arm64, Windows x64 and Linux arm64 and x64 built, passed afterPack's check, and were signed (and on macOS notarized). Installed on the macOS 27 VM, the Windows 11 PC and the Ubuntu 26.04 arm64 VM, a chat's own shell (`workspace.debug.runBash`, no model involved) named the bundled programs for `command -v sort cmp`, reported `sort (uutils coreutils) 0.12.0`, and answered `sort -g`, `uniq -c`, `cmp`, `grep -H`, `date -d '... +3 days'`, `realpath --relative-to`, `shuf`, `head -q` and UTF-8 through `sort | wc -c` as GNU does on all three; `xargs -I{}` on macOS and Linux. On Linux the program's process 1 was `bwrap` with the profile's mounts. A later macOS preview of the fixed table, with the media libraries closed and the helper set at launch, is the one the privacy-dialog and start-cost numbers above come from; Linux x64 and Windows on ARM were built but never run.

## An agent with and without them

`evals/cases/text-tools.ts` asks four questions of a folder of 40 site reports and two CSVs (the five highest turbidities, reports per inspector, reports with no Flags line, where a backup CSV differs). Three runs each, with the fixed table against builtins only (`EVAL_BUILTINS_ONLY=1`); builtins only still runs a host program by name, so on macOS `cmp` there is BSD's.

| | Passed | Calls turned down | Tool calls | Wall time | Tokens |
| --- | --- | --- | --- | --- | --- |
| GLM 5.3 Flash (Workers AI), uutils | 3 of 3 | 0 of 15 | 4, 6, 5 | 45, 115, 169 s | 101 to 125K |
| GLM 5.3 Flash, builtins | 3 of 3 | 2 of 18 (`grep -H`, `diff --changed-group-format`) | 6, 6, 6 | 226, 354, 188 s | 144 to 151K |
| Haiku 5.5 (OpenRouter), uutils | 3 of 3 | 0 of 12 | 5, 3, 4 | 22, 18, 25 s | 120 to 163K |
| Haiku 5.5, builtins | 3 of 3 | 0 of 12 | 3, 4, 5 | 13, 14, 16 s | 117 to 125K |

Both models answered correctly either way. GLM wrote two commands the builtins turned down and recovered from both, at a call and about 30K tokens a run; Haiku wrote none. Wall time on Workers AI is dominated by queuing, and three runs cannot separate the rest. The case measures that the routing costs nothing in answers; the benefit it buys shows in the record's 41 `sort -g` and 28 `grep -H` failures more than in one well-specified task. About $0.04 in all.

A broader run compared the shell before and after the day the routing landed, six cases twice each (baseline `c0f84aeb4`, candidate `8f3d2496e`). GLM 5.3 Flash passed 12 of 12 against 10, Haiku 5.5 10 of 12 against 9, and failed bash calls fell from 17 to 15 and from 9 to 4. Most of that gain was not uutils: the same day fixed Python libraries the sandbox could not import, and ten baseline sessions hit `ModuleNotFoundError` against none. The part that was uutils is the GNU flags: the baseline turned down `sort -g` once and `grep -H` twice, the candidate neither, and after one `grep -H` refusal GLM spent 198 s wandering and failed the text-tools case, which it passed in all four candidate runs.

## What it retires

Little of the patch file. The `sort -h` part (#452) goes, since `sort` never reaches the builtin. The two `find` parts (#451, #555) and the `stat` part (#420) stay, for the builtin `find` and Windows' `stat`. In the known-gaps list it closes the `uniq -c` padding and non-ASCII `sort` order, and `dd`, `realpath` and `shuf` among the missing commands. The larger saving is the patches not yet written: `sort -g`, `grep -H`/`-P`, `xargs -I`/`-n`, `head -q`, `cut --complement` and `cmp` would each have been an upstream pull request and a local diff.

## brush, again

The decision ruled brush out on three counts: its commands are uutils processes, it reads the real filesystem so only an OS sandbox can hold it, and it embeds from Rust only, with Windows in preview. The first is now what this page proposes, and the second is how native commands are already held. What is left:

- **Hosting our commands.** brush-core has custom builtins written in Rust, and since 2026-10-15 (#1508, on `main`, after the 0.4.0 release) a `ProcessLauncher` the host supplies: every external command goes through it, so a host can start them under its own sandbox or answer them without a process at all. `task`, `chat`, `app`, `memory`, `tab`, `jobs`/`fg`/`kill`, the `agent-browser` wrapper and the rule checks would become a sidecar: a Rust binary embedding brush-core whose launcher sends those names to Node over a socket and streams their output back. A command answered that way has no process id, so `$!`, `kill` and job control do not reach it. There is no Node binding.
- **Pipelines.** Real OS pipes. On the Ubuntu VM the 34 MB `sort | uniq -c | wc -l` took 0.83 s under brush 0.4.0 against 0.71 s under bash and 3.8 s under just-bash; `yes | head -3` ends, which no just-bash pipeline can; 50 starts in a loop took 33 ms. Arrays, `[[ =~ ]]`, `local`, here-docs and `printf` answered as bash does. `brush-coreutils-builtins` can also compile uutils in as builtins, with no process per command at all.
- **Windows.** Still preview: built and statically checked in CI with a small test suite, no prebuilt binaries, and "functional for basic usage". On Windows a real shell's redirections, globs and `cd` touch the disk directly, where today `rulesFs` holds every builtin to the rules in-process; with no OS sandbox there, Windows would lose its only enforcement for everything but the commands the launcher hands to Node.

It deserves a spike for macOS and Linux, where the OS sandbox already holds every native command and brush running under the same profile would hold its own redirections too: build the sidecar with a launcher that wraps each command in the cached Seatbelt bytecode or bubblewrap and forwards our commands to Node, and run the agent's shell through it behind a flag. Not before `ProcessLauncher` is in a release, and not for Windows until it has a sandbox ([windows-sandbox.md](../architecture/windows-sandbox.md)), so two shells would ship for a while.

## What would change it

- findutils fixing Windows separators: `find` joins the Windows column and the `find` patches go.
- Streaming pipelines in just-bash (#453), adjacent native stages run as one OS pipeline, or brush: the pipeline row above becomes the terminal's.
- uutils sed's next release with `-z`: worth scoring against the builtin again.
- A Windows OS sandbox. MXC measured about 45 ms a spawn on top of process creation, so a sandboxed native command there costs roughly 70 ms against 25 ms today, which favors keeping more of the Windows column on the builtins. Windows timings taken over plain SSH run in a non-interactive logon session and are not comparable; take them in the interactive session the test-host scripts use.
- The builtin `find` gaining `readdirWithFileTypes` on `MountableFs` (just-bash#597) cuts a 21,000-file `find -type f` from 734 to 135 ms on macOS and from 8.4 s to 0.38 s on Windows, which widens the margin `find` stays a builtin on Windows.
- A builtin `realpath` patch that answers with `/` separators on every host stops applying once `realpath` is routed to uutils; when both land, the Windows respelling of the native `realpath` is the one that holds.
