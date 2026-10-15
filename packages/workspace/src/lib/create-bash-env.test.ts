import { mkdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { createBashDescription, createLocalBashEnv } from "./create-bash-env";
import { chatDir } from "./record-folders";

describe("createBashDescription", () => {
  // Pinned so the snapshot holds the macOS-only commands wherever it runs.
  beforeEach(() => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("matches snapshot", () => {
    expect(createBashDescription()).toMatchInlineSnapshot(`
      "Execute bash commands in this conversation's folder.

      IMPORTANT: Files are at their real paths on the user's computer, and your working directory is this conversation's folder. The folders list in your context says which of the user's folders you reach; every command reads and writes them where they sit, native ones included. A change there lands on the user's real files immediately, so treat \`rm\` there as permanent. "Operation not permitted" means the person keeps that place closed or wants to be asked first; the message says which and what to do.

      IMPORTANT: \`python\` (alias \`python3\`) and \`node\` are real programs: \`python\` runs a skill's script with that skill's packages and anything else in the nearest \`.venv\` up to this conversation's folder, which the first \`pip install\` makes, and \`node\` finds the packages \`pnpm add\` installed beside the script or above it. Both run whatever was installed, can start processes, and read the user's folders where they sit. Packages come from \`pip\`/\`uv\` and \`pnpm\` (\`npm\` is not available). If a system command is unavailable, don't keep probing for equivalent binaries -- a short script can usually do the job, and a missing command does not mean the task is impossible.

      IMPORTANT: Not a persistent terminal -- each call starts fresh from this conversation's folder, your working directory (\`$INSTRUMENT_WORK\`), so \`cd .\` is always a no-op. Prefer relative paths inside it. Scratch files go in the system's temp folder (\`$TMPDIR\`; \`mktemp\` names one there). Shell state (env vars, exported functions, cwd) does NOT carry across calls; to run somewhere else, prefix your command (\`cd subdir && ...\`) within a single call.

      IMPORTANT: Interactive input is not supported -- there is no terminal, so a command that waits at a prompt waits forever. Pass non-interactive flags (\`-y\`, \`--yes\`, \`--no-input\`) instead.
      A command goes to the background by outliving \`yieldMs\`, NOT by \`&\` (\`&\`, \`nohup\` and \`disown\` are unsupported). A command still running when \`yieldMs\` elapses is NOT killed: it keeps running, this call returns a process id, and \`jobs\`, \`fg\` and \`kill\` manage it from there. Start a server or watcher with a small \`yieldMs\` to get its id promptly; leave \`yieldMs\` alone for ordinary commands.
      Those three are ordinary commands, so they compose: \`fg bg_1 | rg -i error\` filters before you pay for the output, \`fg bg_1 && pnpm test\` runs only on success, and \`kill bg_1 bg_2; jobs\` cleans up and confirms in one call.
      A background process is stopped once it has run for 2 hours, whatever it is doing. \`jobs\` reports that as \`stopped (2h cap)\` rather than as a failure or a kill; start it again if the work still needs it.
      Only output written by real binaries (\`pnpm\`, \`node\`, \`python\`, \`uv\`, \`ffmpeg\`, ...) streams while a process runs; a long shell pipeline of builtins reports its output only when it finishes.

      \`curl\` reaches the internet and this computer's own network alike: \`localhost\`, a server you started (\`curl http://127.0.0.1:<port>/\`; pick an explicit port when you start it so you know which one to call), and devices on the user's local network such as \`192.168.x.x\` or \`name.local\` hosts.

      Prefer specialized tools over shell equivalents:
        - Use the \`read_file\` tool instead of \`cat\`/\`head\`/\`tail\`.
        - Use the \`edit_file\`/\`write_file\` tools instead of \`sed\`/\`awk\`/redirects for editing.
        - Use \`rg\` for all searching -- there is no separate search tool. File contents: \`rg -n 'pattern'\`, \`-C 3\` for surrounding lines, \`-l\` for filenames only. Files by name: \`rg --files -g '*.ts'\`, or \`--iglob '*report*'\` to ignore case. It composes, so \`rg -l TODO | head\` works.
        - Filter file names inside \`rg\` with \`-g\`/\`--iglob\` rather than by piping \`rg --files\` into another command. A shell builtin such as \`awk\`, \`sed\` or a \`while read\` loop only starts once the whole listing has been collected, so over a large folder that is seconds of the app frozen, where the same filter inside \`rg\` takes milliseconds.
        - Prefer \`rg\` over \`grep\`/\`egrep\`/\`fgrep\`: \`rg\` is the real ripgrep binary and far faster.
        - For audio, video, or image inspection, prefer \`ffprobe -v error -show_format -show_streams -of json <path>\` over \`file\`.

      TIP: To download a file from a URL, use \`curl -L -o <path> <url>\`. Only write a script when you need to transform or paginate the response.

      TIP: Before using an unfamiliar command, run \`<command> --help\` to check its argument syntax.

      TIP: Heredoc pipes/redirects go on the \`<<EOF\` line, not after \`EOF\`: \`cmd <<'EOF' | jq\` (not \`cmd <<'EOF'\` ... \`EOF\` ... \`| jq\`).

      Available commands (the complete set of unix builtins): alias, awk, base64, basename, bash, cat, chmod, clear, column, comm, cp, cut, date, diff, dirname, du, echo, egrep, env, expand, expr, false, fgrep, file, find, fold, grep, gunzip, gzip, head, help, history, hostname, html-to-markdown, join, ln, ls, md5sum, mkdir, mktemp, mv, nl, od, paste, printenv, printf, pwd, readlink, rev, rm, rmdir, sed, seq, sh, sha1sum, sha256sum, sleep, sort, split, stat, strings, tac, tail, tar, tee, time, timeout, touch, tr, tree, true, unalias, unexpand, uniq, wc, whoami, xargs, yes, zcat

      Any other program on the computer's PATH runs too, held to the same rules as the specialized commands below; \`which <name>\` says whether one is there.

      IMPORTANT: Specialized commands below (e.g. ffmpeg, ffprobe) are invoked by bare name only -- never by an absolute path. These binaries are also on PATH inside node and python scripts, so a script may shell out to \`ffmpeg\`/\`ffprobe\` directly.

      Specialized commands:
        jq - Parse and manipulate JSON
        rg - Search file contents and list files with ripgrep. Pipe and redirect its output like any other command (e.g. \`rg -l TODO | head\`).
        sqlite3 - Query SQLite database files. Dot commands (\`.tables\`, \`.schema\`) are NOT implemented -- list tables with \`select name from sqlite_master where type='table'\`. \`-box\`/\`-json\`/\`-csv -header\` control output
        xan - Fast CSV processing, filtering, aggregation, and visualization
        yq - Parse and manipulate YAML (like jq but for YAML; e.g. \`yq '.key' file.yaml\`)
        agent-browser - Control a browser to navigate the web, interact with pages, and extract content.
      The first agent-browser command in a session returns agent-browser's guide with its output, led by what differs in this app; read it before the next command. \`agent-browser skills get core\` prints it again.
      A bash call whose last page-changing command (open, click, press, select, check, back, ...) is not followed by a read of the page ends with the page's interactive snapshot, or only what changed in it, so act on those refs instead of running \`snapshot -i\` after it.
      IMPORTANT: Never fabricate specific or deep URLs from memory -- they change and training data is stale. Well-known root domains are fine; for anything more specific, use \`web_search\` first to discover the correct URL before opening the browser.
      Drives the in-app browser, which is the only browser available: this build cannot reach the user's own Chrome, their profiles or logins, or any browser running outside the app.
      Do NOT pass session, config, namespace, or plugin flags; those are managed automatically.
        ffmpeg - Process audio and video files using FFmpeg.
        ffprobe - Probe and inspect audio and video files using FFprobe.
        git - Clone and fetch public repositories over http(s), inspect history, branch, and commit locally. Works in any folder the chat can reach (\`git -C <folder> log\`, or \`cd\` there first); in a read-only one it may only read (log, show, diff, blame, status), and committing there needs write on the repository's own folder. No credentials are configured, so private repositories, pushing, and ssh:// remotes are unavailable. Pass commit messages with -m or -F; there is no editor. A large clone that outlives the call keeps running in the background rather than failing, and leaves a partial directory to delete if it is stopped.
        node - Run a TypeScript or JavaScript file as a real process, with the task's installed packages. Types are stripped, not checked. A loaded skill's dependencies resolve only from inside that skill's folder. In -e code: relative paths resolve from cwd. \`await tools.<slug>.<tool>({...})\` calls a connected app's tool as \`app call\` does and returns the result as a value (\`tools["<slug>"]\` for a slug with a hyphen); only the script \`node\` runs has \`tools\`, not a process that script starts.
        shortcuts - Run the user's own Shortcuts on this Mac: whatever they have automated becomes something you can do. \`shortcuts list [--folder-name <folder>]\` names them; \`shortcuts run '<name>' [-i <file>]... [-o <file>]\` runs one, with files as its input and its result written to a file. A shortcut can do anything its steps do, including things the user sees and things that change their data, so run one only when the user asked for it or for what it plainly does.
        mail - Read, search, draft, send, and file email in Mail on this Mac, across every account added to it. \`mail list\`, \`mail search <words>\` and \`mail read <id>\` read it, with lists as one JSON object per line; \`mail draft\` opens a message in Mail for the person to look over and send, and \`mail send\` sends one (\`--to\`, \`--subject\`, \`--attach <file>\`, and the message on stdin); \`mail accounts\`, \`mail mailboxes\` and \`mail move <id> <mailbox>\` cover the rest, and \`mail help\` has every flag. The first time a chat uses Mail the person is asked to allow it, and macOS asks them once to let Instrument control it.
        notes - Read and write the person's notes in Notes on this Mac, iCloud's included. \`notes list\` and \`notes search <words>\` find them, one JSON object per line, \`notes read <id>\` prints one, \`notes create --title <title>\` makes one and \`notes append <id>\` adds to one, with the text on stdin; \`notes folders\` names the folders, and \`notes help\` has every flag. The first time a chat uses Notes the person is asked to allow it, and macOS asks them once to let Instrument control it.
        messages - Send an iMessage or a text from Messages on this Mac: \`messages send --to <phone or email> [--sms]\`, with the message on stdin. Messages can't be read from here, only sent, so send only what the person asked you to send, worded as they saw it. The first time a chat uses Messages the person is asked to allow it, and macOS asks them once to let Instrument control it.
        pnpm - CLI tool for managing JavaScript packages. Global installs (--global / -g) are not supported; packages must be installed locally.
        pnx - Alias for pnpm dlx.
        uv - Python package and environment manager, backing \`python\` and \`pip\`. The very first Python use fetches a managed interpreter (one-time); later uses are fast.
        python - Run Python as a real process: a skill's script with that skill's packages, and your own code with what \`pip\` installed in the nearest \`.venv\` up to this conversation's folder. Each also finds the other's packages where its own have none by that name: a skill's script finds what you installed, and your code the packages of the skill you loaded last. It reads and writes the folders you reach where they sit.
        pip - Install Python packages via uv into the nearest \`.venv\` up to this conversation's folder, which the first install makes at its root, and where \`python\` runs. Use like pip, e.g. \`pip install <package>\`.
        validate-skill - Check a skill written in the workspace's skills folder and report what is wrong with it.
      Errors are what the runtime already acts on: a skill that is never discovered, or one \`load_skill\` refuses. Warnings are authoring rules and context budgets.
      Run it after writing or editing a skill -- a skill with broken frontmatter fails silently, by simply never appearing anywhere.
      Usage: \`validate-skill [<name>...] [--json]\`. With no name it checks every skill in the workspace. Exits non-zero when there are errors.
        jobs - List the background processes this session started, with their status, run time and command.
      Unlike the rest of the shell, this survives across calls: a process started by an earlier call is still listed here. Use it at the start of a turn to find what is already running instead of starting a second copy.
      Usage: \`jobs [--json]\`.
        fg - Bring a background process to the foreground: print what it has written since your last read, and block until it exits.
      Usage: \`fg [<id>...] [--timeout <ms>]\`. With no id it takes everything still running. Exits with the process's own exit code once it finishes, so \`fg bg_1 && pnpm test\` runs the tests only on success. A process that was stopped, or that hit the age cap, never ran to completion and so exits non-zero however far it got.
      \`--timeout 0\` returns immediately with whatever is pending, which is how you glance at a server that never exits. Otherwise it blocks until the process exits, so this is how you wait out a build in one call rather than polling.
      IMPORTANT: it never waits past this \`bash\` call's own \`yieldMs\`; it returns what has arrived by then instead. To wait out something longer, raise \`yieldMs\` on the \`bash\` call rather than the timeout here.
      IMPORTANT: reading consumes -- each call returns only what arrived since the last one, so piping into a filter (\`fg bg_1 | rg error\`) discards the rest. The complete output is always in the process's log file.
        kill - Stop background processes started by \`bash\`, waiting until each has really exited.
      Usage: \`kill <id>...\`, where each id is one \`jobs\` reports (\`bg_1\`). A signal flag (\`-9\`) is accepted and ignored; termination always escalates on its own. Killing one that already finished is harmless.
      Only these ids can be stopped -- there is no access to the machine's own processes, so a bare number is refused.
        task - Start, message, stop and read your tasks: you, carrying on in the background with this conversation in hand. \`task help\` prints the full surface.
        chat - Read the user's other chats: \`chat list [--topic <name>] [-n <count>]\` lists them with where each stands, \`chat read <id or title words> [--tail <n>]\` reads the end of one, \`chat search <words>\` finds a line across all of them, \`chat topics\` names the topics, \`chat tag <chat> <topic>\` files a chat under one. The chat you are in is in front of you; these are for the others.
        memory - What you keep about the user for every chat: \`memory list\` names it all, \`memory save <name>\` keeps or corrects one (the text on stdin through a quoted heredoc), \`memory show <name>\` reads one whole, \`memory forget <name>\` drops it.
        tab - The tabs of the user's window, each named by the id the note on their message gives it, pages, files, folders and screens alike: \`tab open <url or path>...\` opens each in a tab of its own and shows it, printing the tab's id, which a task takes with --tab; \`tab replace <id> <url or path>\` shows something else in a tab; \`tab close <id>...\` closes tabs; \`tab show <id>\` brings an open tab forward; \`tab read <id>\` prints the text of the page in a tab, as the user sees it, signed in where they are. A path is a file or folder you can read. It opens nothing in the user's own applications and downloads nothing."
    `);
  });

  it("includes just-bash built-in tools", () => {
    const description = createBashDescription();
    expect(description).toContain("grep");
    expect(description).toContain("sed");
    expect(description).toContain("awk");
    expect(description).toContain("jq");
    expect(description).toContain("diff");
  });

  it("includes all commands in a single list", () => {
    const description = createBashDescription();
    expect(description).toContain("pnpm");
    expect(description).toContain("grep");
    expect(description).toContain("jq");
  });

  it("does not advertise npx", () => {
    expect(createBashDescription()).not.toContain("npx");
  });

  it("names one Python and one Node", () => {
    const description = createBashDescription();
    expect(description).not.toContain("python-native");
    expect(description).not.toContain("js-exec");
  });
});

describe("osascript", () => {
  beforeEach(() => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses AppleScript the agent writes, and names the commands that reach the apps", async () => {
    const chatId = createMockChatConfig(
      ChatIdSchema.parse("osascript-refused"),
    );
    await mkdir(chatDir(chatId), { recursive: true });
    const bash = await createLocalBashEnv({
      chatId,
      sessionId: StoreId.newSessionId(),
    });
    const result = await bash.exec(
      `osascript -e 'tell application "Notes" to get name of every note'`,
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "osascript: AppleScript you write doesn't run here.",
    );
    expect(result.stderr).toContain("`mail`, `notes` and `messages` commands");
  });
});
