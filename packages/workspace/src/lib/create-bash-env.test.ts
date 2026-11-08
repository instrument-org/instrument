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
    // Representative builtins rather than the whole set, which follows
    // just-bash; the specialized ones are ours, so all of them.
    expect(builtins?.split(", ")).toEqual(
      expect.arrayContaining(["awk", "find", "grep", "sed", "tar", "xargs"]),
    );
    expect(specialized).toMatchInlineSnapshot(`
      [
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
        "instrument window",
      ]
    `);
  });

  // One Python, one Node, no npx, and none of the Mac's own commands.
  it.each(["npx", "python-native", "js-exec", "osascript"])(
    "does not advertise %s",
    (name) => {
      expect(createBashDescription()).not.toContain(name);
    },
  );
});

describe("osascript", () => {
  beforeEach(() => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses AppleScript the agent writes, and names the apps that reach the Mac's own", async () => {
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
      "Calendar, Contacts, Mail, Messages, Notes, Reminders are apps",
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
        task    Start, message, stop and read your tasks.
        window  What is in front of the user: list, show, read and close this chat's tabs, or ask for one of theirs.
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

  // The Mac's own apps are apps in Apps, so `instrument` has no words of
  // its own for them, on a Mac with the helper as anywhere.
  it("lists no Mac app commands on macOS", async () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    const chatId = createMockChatConfig(
      ChatIdSchema.parse("instrument-mac-apps"),
    );
    await mkdir(chatDir(chatId), { recursive: true });
    const config = getWorkspaceConfig();
    setWorkspaceConfig({
      ...config,
      macHelperBinPath: AbsolutePathSchema.parse("/app/bin/instrument-mac"),
    });
    try {
      const bash = await createLocalBashEnv({
        chatId,
        role: "task",
        sessionId: StoreId.newSessionId(),
      });
      const listed = (await bash.exec("instrument")).stdout
        .split("\n")
        .flatMap((line) => /^ {2}(\S+) /.exec(line)?.[1] ?? []);
      expect(listed).toEqual(["app", "memory", "window", "x"]);
    } finally {
      setWorkspaceConfig(config);
    }
  });

  it("gives a task reading forms of `memory` and `window`, and says `task` is the chat's", async () => {
    const bash = await shell("instrument-task", "task");
    expect((await bash.exec("instrument")).stdout).toMatchInlineSnapshot(`
      "Usage: instrument <command> ...

        app     Connect services and call their tools.
        memory  What you keep about the user for every chat.
        window  What is in front of the user: list, show, read and close this chat's tabs, or ask for one of theirs.
        x       Search posts on X through the user's Grok account.

      \`instrument <command> help\` prints one command's own usage.
      "
    `);
    const saved = await bash.exec("instrument memory save x <<< 'y'");
    expect(saved.exitCode).toBe(1);
    expect(saved.stderr).toMatchInlineSnapshot(`
      "instrument memory: only the chat saves and forgets memories. Say in your report what the chat should remember or forget.
      "
    `);
    expect((await bash.exec("instrument memory list")).exitCode).toBe(0);
    const started = await bash.exec("instrument task new --name x <<< 'y'");
    expect(started.exitCode).toBe(1);
    expect(started.stderr).toMatchInlineSnapshot(`
      "instrument task: you are a task the chat started, and the chat alone starts and steers tasks. Do your assignment here, and say in your report what is left.
      "
    `);
  });
});
