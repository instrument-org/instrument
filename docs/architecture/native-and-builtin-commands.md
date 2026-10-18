# Native and builtin commands

Which commands in the agent's shell run as real programs and which run as just-bash builtins (TypeScript inside the shell), per platform, and how a name is routed to one or the other. The table of GNU text commands below is generated from the code, so it is what runs. Why it is shaped this way, with the measurements, is in [the uutils finding](../findings/gnu-text-commands-on-bundled-uutils.md); how native programs are held to the rules is in [agent-sandbox.md](agent-sandbox.md).

## How a name is routed

`create-bash-env.ts` builds the shell. A command name resolves in this order:

1. **The shell's own builtins and keywords** (`cd`, `export`, `printf`, `test`, `[[`, functions the script defines). Nothing shadows these.
2. **Our custom commands**, registered after just-bash's bundled commands so each shadows the bundled command of the same name: the GNU text commands below, `rg`, `du`, `git`, the interpreters, the Mac helpers, `which`, `jobs`/`fg`/`kill`, and `instrument`, whose subcommands are Instrument's own: `app` in every shell, and a chat's `task`, `chat`, `memory` and `tab`.
3. **just-bash's bundled commands** (`cat`, `ls`, `sed`, `awk`, `jq`, `curl`, ...), less `which`, which ours replaces.
4. **Any program on the computer's PATH**, through the `resolveExternalCommand` hook our just-bash patch adds (`shell-commands/path-program.ts`): the first regular file this user may execute, or on Windows the name with each PATHEXT extension. A name with a `/` runs natively when it names a `#!` script or a Mach-O, ELF or PE binary.

A name found nowhere is `command not found`, status 127. `command -v`, `type` and our `which` answer from the same lookup, naming a native command by the program it runs.

Since step 4 reaches every program on the PATH, a name in step 2 hides the real program by that name. Commands about Instrument itself rather than a tool are therefore words under one `instrument` command (`shell-commands/instrument.ts`): a bare `chat` or `task` at the top level would hide `/usr/sbin/chat` or a Taskwarrior install. Wrappers of real tools keep the tool's own name, since hiding the real one is what they are for.

## Preference order

For a command more than one implementation could answer, the shell uses the one that answers most like GNU on the corpus in [the uutils finding](../findings/gnu-text-commands-on-bundled-uutils.md):

1. **uutils**, for every command in the table below marked `uutils`.
2. **The computer's own program**, where it scores measurably better than the builtin and every platform it is routed on carries one; the table marks these `system`, and the paragraphs under it give the scores.
3. **The just-bash builtin** for everything else it has.

The order is re-checked on each uutils release and whenever a builtin is patched: run the corpus against each implementation and move a command when its scores change.

## GNU text commands on uutils or the system

The commands below run the bundled uutils (MIT; `apps/studio/scripts/download-uutils.ts` vendors them into `resources/uutils`, pinned by sha256, from [instrument-org/uutils-build](https://github.com/instrument-org/uutils-build), which builds the upstream releases with the patches listed in its README) on the platforms marked, and the just-bash builtin elsewhere, or the computer's PATH for a command just-bash lacks. Each runs as a native command: under the native sandbox, with the shell's working directory, environment, stdin and cancellation, and every argument that names an existing path is first held to the rules, so a card names the exact path a builtin would. On Windows every argument goes to uutils quoted, since it expands `*`, `?` and `[...]` in an unquoted one, and `realpath`'s backslashes become slashes. A row marked `system` runs the computer's own program from a fixed location (`/usr/bin`, `/bin` on Linux, `System32` on Windows) the same way, and the builtin answers on a computer without it.

<!-- generated: native-text routes; `pnpm fix` writes this -->

| Command | macOS | Linux | Windows | From | Builtin with |
| --- | --- | --- | --- | --- | --- |
| `arch` | uutils | uutils | uutils | uutils coreutils |  |
| `b2sum` | uutils | uutils | uutils | uutils coreutils |  |
| `base32` | uutils | uutils | uutils | uutils coreutils |  |
| `basenc` | uutils | uutils | uutils | uutils coreutils |  |
| `cksum` | uutils | uutils | uutils | uutils coreutils |  |
| `cmp` | uutils | uutils | uutils | uutils diffutils |  |
| `comm` | uutils | uutils | uutils | uutils coreutils |  |
| `cut` | uutils | uutils | uutils | uutils coreutils |  |
| `date` | uutils | uutils | uutils | uutils coreutils |  |
| `dd` | uutils | uutils | uutils | uutils coreutils |  |
| `df` | uutils | uutils | uutils | uutils coreutils |  |
| `diff` | system | system | builtin | system |  |
| `factor` | uutils | uutils | uutils | uutils coreutils |  |
| `file` | system | system | builtin | system |  |
| `find` | uutils | uutils | uutils | uutils findutils |  |
| `fmt` | uutils | uutils | uutils | uutils coreutils |  |
| `grep` | uutils | uutils | uutils | uutils grep |  |
| `head` | uutils | uutils | uutils | uutils coreutils |  |
| `id` | uutils | uutils | PATH | uutils coreutils |  |
| `join` | uutils | uutils | uutils | uutils coreutils |  |
| `md5sum` | uutils | uutils | uutils | uutils coreutils |  |
| `nproc` | uutils | uutils | uutils | uutils coreutils |  |
| `numfmt` | uutils | uutils | uutils | uutils coreutils |  |
| `od` | uutils | uutils | uutils | uutils coreutils |  |
| `pr` | uutils | uutils | uutils | uutils coreutils |  |
| `realpath` | uutils | uutils | uutils | uutils coreutils |  |
| `seq` | uutils | uutils | uutils | uutils coreutils |  |
| `sha224sum` | uutils | uutils | uutils | uutils coreutils |  |
| `sha256sum` | uutils | uutils | uutils | uutils coreutils |  |
| `sha384sum` | uutils | uutils | uutils | uutils coreutils |  |
| `sha512sum` | uutils | uutils | uutils | uutils coreutils |  |
| `shuf` | uutils | uutils | uutils | uutils coreutils |  |
| `sort` | uutils | uutils | uutils | uutils coreutils |  |
| `stat` | uutils | uutils | builtin | uutils coreutils |  |
| `tail` | uutils | uutils | uutils | uutils coreutils |  |
| `tar` | system | system | system | system |  |
| `tsort` | uutils | uutils | uutils | uutils coreutils |  |
| `uname` | uutils | uutils | uutils | uutils coreutils |  |
| `uniq` | uutils | uutils | uutils | uutils coreutils |  |
| `wc` | uutils | uutils | uutils | uutils coreutils |  |
| `xargs` | uutils | uutils | uutils | uutils findutils | `-P`, `--max-procs` |

<!-- end generated -->

Most of the table replaces a builtin. The rest fills gaps: `arch`, `b2sum`, `base32`, `basenc`, `cksum`, `df`, `factor`, `fmt`, `id`, `nproc`, `pr`, `sha224sum`, `sha384sum`, `sha512sum`, `tsort` and `uname` are commands just-bash does not have, which would otherwise reach the PATH: the BSD versions on macOS, with their own flags, and on Windows usually nothing. Only the ones that print are routed. The coreutils that change the system or act on other processes (`shred`, `chown`, `chgrp`, `chroot`, `mknod`, `mkfifo`, `stty`, `install`, `link`, `unlink`, `sync`, `nice`, `nohup`, `timeout`, `kill`) and the ones that report on the computer's users (`who`, `users`, `pinky`, `uptime`, `hostid`, `logname`) stay with the PATH. `id` falls to the PATH on Windows, since uutils does not build it there.

`diff` runs the system's: BSD diff on macOS answers 9 of the corpus's 11 diff cases against GNU, where the builtin answers 5 and uutils diffutils 3, and Linux carries GNU diff itself. The two BSD misses are `-u` and `-ru`, whose file headers print the time without GNU's nanoseconds and zone. Re-scored through the agent's shell after routing, it still answers 9 of 11.

`file` runs the system's too, which macOS and Linux both carry; it is the same program on both, so there is no corpus score, and the comparison is against what it reports. Over 27 files of common types the builtin named 3 wrong (64 random bytes as UTF-8 text, UTF-8 text as ASCII, an SVG as XML), went by the extension for CSV and Markdown, and gave no image size, page count or architecture, which the system's does. In 33 real `file` calls the builtin's failures were not wrong answers: five were a `process.env` error the env-write patch since fixed, two an old stub's "file is not available", and two files that really were missing; where it ran, it named every PNG, JPEG, PDF and text file right.

`tar` runs the system's on every platform: bsdtar on macOS and in Windows' `System32` (Windows 10 and later), GNU tar on Linux. The builtin builds the whole archive in memory, refuses any file over the shell's 256 MB read cap (`EFBIG`), and has no xz without `node-liblzma`'s native build; the system's streams, and reads xz and zstd. The failures in older real calls (`tar czf` answering "You must specify one of -c, -r, -u, -x, or -t", or "non-functional in the sandboxed environment") came from earlier builds, and the current builtin answers those calls. What tar writes is held to the rules before it starts: the archive it creates or adds to, and the folder it extracts into (`-C`, or the working directory), so extracting into a closed folder raises the card rather than failing on the sandbox's `Operation not permitted`. It runs with `--exclude=.instrument` when it creates or extracts, as `find` gets its prune, and on macOS with `COPYFILE_DISABLE=1`, so no `._` file of metadata lands beside each file. Extraction is held by Seatbelt and bubblewrap like any native command, and is unconfined on Windows, as every native program is there. An archive written to stdout (`-f -`, or no `-f`, which it is given as `-f -` since bsdtar on Windows would write to a tape drive) runs natively too and reaches the shell as bytes even when it decodes as UTF-8, as an uncompressed archive of text does, so the redaction text gets never touches it; reading one from stdin works natively. `gzip`, `gunzip` and `zcat` stay builtins.

On Windows `find` and `grep` run with `UUTILS_PATH_SEPARATOR=slash`, which the uutils-build patch reads: the paths they walk come back joined with `/`, as the shell spells them, and `-path` and `-prune` patterns written with `/` match (uutils/findutils#907, uutils/grep#143). `stat` stays the builtin there, since uutils does not build it for Windows. `xargs` runs natively there with a folder of hard links to the coreutils binary first on its PATH (`echo.exe`, `printf.exe`, `basename.exe`; not `expand`, `hostname`, `more`, `timeout` or `whoami`, which System32 also has), since what it starts is a program on the PATH and Windows has none of those.

The last column names the arguments that send one call to the builtin on every platform. uutils xargs 0.10.0 accepts `-P` but runs its commands one at a time, while the builtin runs that many at once, so an `xargs` with `-P N`, `-ON` or `--max-procs` in its options (`xargsRunsParallel`) is the builtin's. Drop the rule once a uutils release runs `-P` in parallel.

`find` gets a prune of every `.instrument` folder by name and of the chat's `tasks/` by path ahead of the caller's expression, and only its start points are held to the rules as paths; each folder the sandbox refuses on the way is counted in one stderr line. Without `uutilsDir` in the workspace config (a checkout that never ran `uutils:download`, most tests) every command in the table is the builtin, or the PATH's where just-bash has none.

## Other native programs

| Command | Program | Platforms |
| --- | --- | --- |
| `rg` | ripgrep from `@vscode/ripgrep`, with flags that run other programs refused | all |
| `git` | dugite's git, with our argv policy and an isolated environment | all |
| `python`, `pip`, `uv` | the chat's virtualenv interpreter and the bundled uv | all |
| `node` | Electron run as Node, with a `tools` global over loopback | all |
| `pnpm`, `pnx`, `pnpx`, `npx` | the bundled pnpm (`npx` and `pnpx` are `pnpm dlx`) | all |
| `ffmpeg`, `ffprobe` | `ffmpeg-ffprobe-static` | all |
| `agent-browser` | the agent-browser CLI, spawned directly with its own flag policy rather than under the native sandbox | all |
| `calendar`, `contacts` | the Mac helper (`instrument-mac`) | macOS |
| `osascript` | `/usr/bin/osascript`, unwrapped only for a script whose apps are all allowed | macOS |
| `shortcuts` | `/usr/bin/shortcuts` | macOS |
| anything else on the PATH | itself | all |

`du` is ours but not a process: it walks the real folders in a worker thread.

## When a pipeline streams

just-bash runs a pipeline's stages one after another and hands each stage the previous one's whole stdout, so a builtin stage starts only once the stage before it has finished. Two native programs side by side are the exception: the producer returns while it is still running, and the consumer takes its stdout as its own fd 0, so the bytes go from program to program through an OS pipe and never through the shell (`shell-commands/pipe-stage.ts`, on the `pipe handoffs` part of the just-bash patch). That gives the shell what a real one does for those stages:

- A consumer that stops early ends the producer: `rg … | head -5` stops the walk, and the producer's status is 141 (SIGPIPE), as in bash.
- Nothing between them is held in memory or counted against the output limits, so `rg`'s 8 MB cap and the 256 MiB output bound apply only to what the pipeline collects at its end or hands to a builtin.
- Bytes cross unchanged, binary included. The buffered path carries them unchanged too, unless they are UTF-8 text the command renders (below).
- A background run's live output carries what the last stage prints and every stage's stderr, never what one stage hands the next.

Every command in the table above streams where it runs as uutils, and so do `rg`, `git`, `python`, `pip`, `uv`, `node` and any program on the PATH. A stage that is a builtin, a function or a compound command (`while read`, `{ …; }`) gets the bytes instead, as before: the producer's output is collected when that stage starts. So does a consumer whose fd 0 a redirection replaces, and a producer that redirects its stdout or merges stderr into it (`> file`, `2>&1`, `|&`); `2>/dev/null` on a producer keeps it streaming, and a consumer may redirect its own output. Each stage is its own process under its own sandbox wrap, so a refused path is still attributed to the stage that hit it, and a kill or an abort stops every stage through its own process tree.

What a native command hands the shell itself, to a redirect, a builtin, or the shell's own output, is one of two things (`binaryStdout` in `shell-commands/exec-shim.ts`). Output that is UTF-8 is text, after the command's rendering for the agent: credentials redacted, a carriage-return progress line collapsed to its last state, and on Windows drive paths respelled (`filterShellOutput`, `collapseProgress`); the shell encodes it back as UTF-8. Anything else is the program's exact bytes, marked as bytes, so `python gen.py > out.png`, `ffmpeg … -f image2pipe - > frame.png` and `head -c 512 file.bin | base64` get what the program wrote, and only the shell's final output decodes them for display, as it shows a builtin `cat` of a binary file: UTF-8 as text, and each byte outside a UTF-8 sequence as the Latin-1 character of its value (`héllo` and a stray 0x89 read `héllo\u0089`; the lenient display part in [just-bash-upstream.md](just-bash-upstream.md)). A program's stderr and a background run's live view are decoded the same way (`decodeForDisplay` in `shell-commands/output-sink.ts`), so the live view matches the final output and a background run does not report it twice. A compound command's redirect (`{ …; } > f`, a loop's `> f`) still writes such bytes altered, a just-bash gap listed there.

On Windows the bytes take one step through the app instead of going straight from program to program: the end of the producer's pipe that Node holds is opened for overlapped I/O, and a program that reads its stdin synchronously (uutils, ripgrep) can abort on it, so each consumer gets a pipe of its own and the app copies into it, still a stream with backpressure. Windows has no SIGPIPE either, so a producer whose reader stopped early complains on stderr (`write failed: 'standard output': Broken pipe`); that line is dropped and the producer reports 141, so `PIPESTATUS` and `pipefail` read as they do on macOS and Linux.

`INSTRUMENT_NATIVE_PIPES=0` in the app's environment turns streaming off, which is how to compare a pipeline against the buffered path. Holding a producer's stdout unread until the consumer starts uses a private member of Node's child stdio streams (`_handle.readStop`); where it is missing, the stage falls back to the buffered path on its own, and `pipe-stage.test.ts` fails if a Node or Electron upgrade changes it.

## What stays a builtin, and why

- `cat`, `ls`, `cp`, `mv`, `rm`, `touch`, `mkdir`: they act on the shell's filesystem, which hides the app's own entries (`.instrument`, `tasks/`) and holds every path to the rules as it goes; `ls` natively would list what the app hides.
- `tr`: it answers as GNU does on the corpus but for `tr '\0'`, and it runs in loops, where a native start per iteration costs more.
- `diff` on Windows, which has no diff of its own: uutils diffutils lacks `-r`, `-w`, `-i` and `-y` (its `cmp` is in the table).
- `sed`: uutils sed ties the builtin and lacks `-z` in a release, and BSD sed on macOS scores below it (11 of 14 against 12).
- `awk`: no permissive awk matches gawk; goawk fails the same cases the builtin does, and BSD awk on macOS scores below it (9 of 12 against 10).
- `jq`, `yq`, `xan`, `sqlite3`, `curl` and the other bundled commands with no GNU counterpart.
- `printf`, `echo`, `test` and the rest of the shell's own: they are the interpreter's and cannot be shadowed.

## Calls that skip the OS sandbox

Starting a program under the OS sandbox costs a few milliseconds on macOS and tens of them under MXC on Windows, and a loop of `head -1 "$f"` or a pipeline of text tools pays it for every program it starts. So a call of the bundled uutils that cannot reach a file runs unwrapped (`shell-commands/unsandboxed-uutils.ts`). A uutils program reaches the disk only through a path it is given, an option that names a file, its environment, or its own files, and the rules close each of those:

- **Tier A, no file.** Every option is on a closed list per command, read against the sources of the release `REVIEWED` names, and the call names no file: `| head -5`, `sort -rn`, `wc -l`, `grep -c foo`, `date +%F`, `seq 10`. Long options count only in their exact spelling, because clap takes any unambiguous prefix (`--files0` is `--files0-from`, `--comp` is `--compress-program`). Options that read or write a file (`--files0-from`, `--random-source`, `sort -o`/`-T`/`--compress-program`, `grep -f`/`-r`/`-d`/`--exclude-from`, `date -f`/`-r`, `sha256sum -c`) and anything not on the list keep the call sandboxed.
- **Tier B, one file the shell opens.** A call that names exactly one file (`head -n 1 notes.txt`, `wc -l notes.txt`, `grep -n foo notes.txt`) runs unwrapped only when the shell can open that file for it: after every link is followed it is a regular file with one name, inside a folder the chat reaches and not one of the app's own, that the rules let the agent read (allow, not ask or hidden), with no NTFS stream; and the file opened has the device and inode that were checked, before and after. The open file becomes the program's stdin and the name leaves its arguments, so the program opens nothing. Its output is made byte for byte what it prints for the file by name: grep gets `--label=<name>`, and wc with one count gets ` <name>` after the count. Two files, a second `uniq` operand (which it writes), wc with two counts (whose width comes from the file's size), `head -v` and `grep -T` stay sandboxed, as does a stage whose stdin is the previous program's pipe, and a wc whose output goes straight to the next program.
- **The environment is built from nothing**: locale variables that read as locale names, `TZ` only as a zone name (a path is a file the time zone library would read), `TMPDIR` set to the app's own folder for sort's spill, `NO_COLOR`, `TERM=dumb`, and `SystemRoot` on Windows. Nothing the agent exported reaches the program: no `PATH`, `DYLD_*`, `LD_*`, `POSIXLY_CORRECT` or `_POSIX2_VERSION` (they change how arguments parse, and the list is the parser that matters).
- **The binary is the reviewed one.** Each is hashed once per launch against the sha256 `REVIEWED` holds for this target, which `download-uutils.ts` pins as well, and before each later run its identity on disk (device, inode, size, times) is compared with what was hashed. The hashes live in the app's code rather than beside the binaries, which whoever could change a binary could change too.

Anything that fails a check runs sandboxed exactly as before, so the tiers change how fast a call starts, never what it prints. `find`, `xargs`, `grep -r`, `cmp`, `comm`, `join`, `dd`, `stat`, `realpath`, `df`, `diff`, `file` and `tar` always run sandboxed. In a pipeline each stage decides for itself, so unwrapped stages and wrapped ones join by the same pipes, and a stage cut off by its reader still reports 141.

The workspace config's `uutilsOutsideSandbox` turns this on; Studio, `run-bash` and the eval harness set it, and a test gets the sandboxed path unless it asks. Changing the uutils release in `download-uutils.ts` fails `unsandboxed-uutils.test.ts` until the rules are read again against the new sources and `REVIEWED` is updated. On macOS `unsandboxed-uutils-canary.test.ts` runs every corpus call under a Seatbelt profile that refuses reading any file but the binaries' folder and the system's libraries and time zones, and holds its output equal to the plain run, so a release that starts reading a file of its own shows up there.

What it gives up: on Linux an unwrapped program loses bubblewrap's PID namespace and the step that closes the app's inherited descriptors, which is safe only because no call on the list names `/dev/fd/N` and tier B refuses paths outside the chat's folders. The CPU and memory a program may use are what they were, since the sandbox never limited them.

## The launcher and the sandbox

On macOS every native command starts through `instrument-seatbelt` (`apps/studio/native/mac-helper/seatbelt`, built with the Mac helper): the chat's Seatbelt profile is compiled to bytecode once per set of rules, held in memory, and handed to the launcher, which applies it and execs the program, about 6 ms a start. It exits 126 without running anything when the bytecode cannot be applied. Where the launcher is missing or cannot compile a profile, the command starts through `/usr/bin/sandbox-exec`, about 22 ms a start. Linux wraps each command in bubblewrap; Windows has no OS sandbox yet ([windows-sandbox.md](windows-sandbox.md)).

The OS sandbox refuses; it does not hide. A program it holds gets `Operation not permitted` (Seatbelt) or an empty folder (bubblewrap) for a closed path, and it still sees the app's own entries that the shell's filesystem hides, which is why `find` carries the prune above and why `ls` stays a builtin. On macOS the sandbox is consulted before macOS's own privacy check, so a folder the rules close never raises macOS's dialog; the Photos, Music and TV libraries are places for that reason.

## Known divergences from GNU

What uutils answers differently from GNU, from a corpus of 245 model-written invocations run against GNU coreutils, findutils, diffutils and grep: `find -newermt` with a time (the builtin misses it too), `date -d '... next friday'`, and on Windows `stat` (not built) and `find -printf` times, which uutils prints in local time there whatever `TZ` says. The builtins that remain diverge in their own ways (`tr '\0'`, `sed -z`, gawk's extensions). To re-score after a uutils release, run the corpus in the finding against GNU on Linux and against each platform's build; the method and the last scores are in [the uutils finding](../findings/gnu-text-commands-on-bundled-uutils.md).
