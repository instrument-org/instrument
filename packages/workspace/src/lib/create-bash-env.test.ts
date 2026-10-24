import { mkdir } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { AbsolutePathSchema } from "../schemas/paths";
import { StoreId } from "../schemas/store-id";
import { createMockChatConfig } from "../test/helpers/mock-chat-config";
import { createBashDescription, createLocalBashEnv } from "./create-bash-env";
import { chatDir } from "./record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";

describe("createBashDescription", () => {
  // Pinned to a Mac, whose platform adds the most commands of its own, none
  // of which may reach the description.
  beforeEach(() => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The commands a Mac chat is told it has, by name. Their wording is the
  // prompt's, edited where it is written, so only the set is pinned here.
  // A tool definition is in the prefix a provider caches, so it reads the
  // same on every computer a build runs on.
  it("reads the same on every platform", () => {
    const onMac = createBashDescription();
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect(createBashDescription()).toBe(onMac);
  });

  it("names the builtins and specialized commands every computer has", () => {
    const description = createBashDescription();
    const builtins = /^Available commands \(.*?\): (.*)$/m.exec(
      description,
    )?.[1];
    const specialized = description
      .slice(description.indexOf("Specialized commands:\n"))
      .split("\n")
      .slice(1)
      // A command's own line is indented; a description's further lines are not.
      .flatMap((line) => /^ {2}(\S.*?) - /.exec(line)?.[1] ?? []);
    expect({ builtins: builtins?.split(", "), specialized })
      .toMatchInlineSnapshot(`
        {
          "builtins": [
            "alias",
            "arch",
            "awk",
            "b2sum",
            "base32",
            "base64",
            "basename",
            "basenc",
            "bash",
            "cat",
            "chmod",
            "cksum",
            "clear",
            "cmp",
            "column",
            "comm",
            "cp",
            "cut",
            "date",
            "dd",
            "df",
            "diff",
            "dirname",
            "du",
            "echo",
            "egrep",
            "env",
            "expand",
            "expr",
            "factor",
            "false",
            "fgrep",
            "file",
            "find",
            "fmt",
            "fold",
            "grep",
            "gunzip",
            "gzip",
            "head",
            "help",
            "history",
            "hostname",
            "html-to-markdown",
            "join",
            "ln",
            "ls",
            "md5sum",
            "mkdir",
            "mktemp",
            "mv",
            "nl",
            "nproc",
            "numfmt",
            "od",
            "paste",
            "pr",
            "printenv",
            "printf",
            "pwd",
            "readlink",
            "realpath",
            "rev",
            "rm",
            "rmdir",
            "sed",
            "seq",
            "sh",
            "sha1sum",
            "sha224sum",
            "sha256sum",
            "sha384sum",
            "sha512sum",
            "shuf",
            "sleep",
            "sort",
            "split",
            "stat",
            "strings",
            "tac",
            "tail",
            "tar",
            "tee",
            "time",
            "timeout",
            "touch",
            "tr",
            "tree",
            "true",
            "tsort",
            "unalias",
            "uname",
            "unexpand",
            "uniq",
            "wc",
            "whoami",
            "xargs",
            "yes",
            "zcat",
          ],
          "specialized": [
            "jq",
            "rg",
            "sqlite3",
            "xan",
            "yq",
            "agent-browser",
            "ffmpeg",
            "ffprobe",
            "git",
            "node",
            "pnpm",
            "pnx",
            "uv",
            "python",
            "pip",
            "validate-skill",
            "jobs",
            "fg",
            "kill",
            "instrument x",
            "instrument task",
            "instrument memory",
            "instrument tab",
          ],
        }
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
    expect(result.stderr).toContain(
      "`instrument mail`, `instrument notes` and `instrument messages` commands",
    );
  });
});

describe("instrument", () => {
  // Off macOS, so the listings hold only Instrument's own commands.
  beforeEach(() => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function shell(name: string, role: "chat" | "task") {
    const chatId = createMockChatConfig(ChatIdSchema.parse(name));
    await mkdir(chatDir(chatId), { recursive: true });
    return createLocalBashEnv({
      chatId,
      role,
      sessionId: StoreId.newSessionId(),
    });
  }

  it("lists the chat's own commands, bare or asked for help", async () => {
    const bash = await shell("instrument-chat-help", "chat");
    const bare = await bash.exec("instrument");
    expect(bare.exitCode).toBe(0);
    expect(bare.stdout).toMatchInlineSnapshot(`
      "Usage: instrument <command> ...

        app     Connect services and call their tools.
        memory  What you keep about the user for every chat.
        tab     List, open, show, read and close this chat's tabs, or ask for one of the user's.
        task    Start, message, stop and read your tasks.
        x       Search posts on X through the user's Grok account.

      \`instrument <command> help\` prints one command's own usage.
      "
    `);
    expect((await bash.exec("instrument help")).stdout).toBe(bare.stdout);
  });

  it("runs a subcommand with the rest of its words", async () => {
    const bash = await shell("instrument-chat-run", "chat");
    const result = await bash.exec("instrument memory help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: instrument memory <subcommand>");
  });

  it("refuses a command it does not have", async () => {
    const bash = await shell("instrument-unknown", "chat");
    const result = await bash.exec("instrument mail list");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('instrument: unknown command "mail".');
  });

  // The Mac's own apps are offered where they can be reached: Mail, Notes
  // and Messages on any Mac, Calendar and Contacts where the build carries
  // the helper, and in a task's shell as in the chat's.
  it.each([
    [undefined, ["mail", "messages", "notes"]],
    [
      "/app/bin/instrument-mac",
      ["calendar", "contacts", "mail", "messages", "notes"],
    ],
  ])(
    "lists the Mac app commands on macOS with the helper at %s",
    async (bin, words) => {
      vi.stubGlobal("process", { ...process, platform: "darwin" });
      const chatId = createMockChatConfig(
        ChatIdSchema.parse("instrument-mac-apps"),
      );
      await mkdir(chatDir(chatId), { recursive: true });
      const config = getWorkspaceConfig();
      const { macHelperBinPath: _absent, ...without } = config;
      setWorkspaceConfig(
        bin === undefined
          ? without
          : { ...config, macHelperBinPath: AbsolutePathSchema.parse(bin) },
      );
      try {
        const bash = await createLocalBashEnv({
          chatId,
          role: "task",
          sessionId: StoreId.newSessionId(),
        });
        const listed = (await bash.exec("instrument")).stdout
          .split("\n")
          .flatMap((line) => /^ {2}(\S+) /.exec(line)?.[1] ?? []);
        expect(listed).toEqual(["app", ...words, "x"]);
      } finally {
        setWorkspaceConfig(config);
      }
    },
  );

  it("gives a task only `app`, and says the rest are the chat's", async () => {
    const bash = await shell("instrument-task", "task");
    expect((await bash.exec("instrument")).stdout).toMatchInlineSnapshot(`
      "Usage: instrument <command> ...

        app  Connect services and call their tools.
        x    Search posts on X through the user's Grok account.

      \`instrument <command> help\` prints one command's own usage.
      "
    `);
    const result = await bash.exec("instrument memory save x <<< 'y'");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument memory: only the chat has this. Say in your report what the chat should do with it.
      "
    `);
  });
});
