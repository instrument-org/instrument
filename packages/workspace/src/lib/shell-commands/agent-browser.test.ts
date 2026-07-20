import { type CommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { TaskIdSchema } from "../../schemas/task-id";
import { createMockTaskConfig } from "../../test/helpers/mock-task-config";
import {
  createAgentBrowserCommand,
  isDaemonConfigRace,
  isExternalBrowserInvocation,
  scrubHostPaths,
} from "./agent-browser";
import { findSubcommand } from "./agent-browser-flags";

const mockCtx: CommandContext = {
  cwd: "/",
  env: new Map<string, string>(),
  fs: new InMemoryFs(),
  stdin: EMPTY_BYTES,
};

describe("createAgentBrowserCommand", () => {
  const taskId = createMockTaskConfig(TaskIdSchema.parse("test"));
  const command = createAgentBrowserCommand({
    sessionId: StoreId.newSessionId(),
    taskId,
  });

  it("returns managed help with read guidance", async () => {
    const result = await command.execute(["--help"], mockCtx);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("agent-browser read");
    expect(result.stdout).toContain(
      "Read the active page as agent-friendly text",
    );
    expect(result.stdout).toContain("--auto-connect");
  });

  it.each([
    { flag: "--config" },
    { flag: "--namespace" },
    { flag: "--session" },
    { flag: "--session-name" },
  ])("blocks harness-owned flag $flag", async ({ flag }) => {
    const result = await command.execute([flag, "value", "open"], mockCtx);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`flag ${flag} is not allowed`);
  });

  it.each([
    { subcommand: "auth" },
    { subcommand: "batch" },
    { subcommand: "connect" },
    { subcommand: "install" },
    { subcommand: "mcp" },
    { subcommand: "plugin" },
    { subcommand: "session" },
  ])(
    "blocks workspace-managed subcommand $subcommand",
    async ({ subcommand }) => {
      const result = await command.execute([subcommand], mockCtx);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        `subcommand '${subcommand}' is not available`,
      );
    },
  );
});

describe("scrubHostPaths", () => {
  const opts = {
    homeDir: "/Users/jane",
    taskDirPath: "/Users/jane/tasks/t1",
  };

  it.each([
    {
      expected:
        "Chrome profiles (~/Library/Application Support/Google/Chrome):",
      name: "home-dir paths become ~",
      output:
        "Chrome profiles (/Users/jane/Library/Application Support/Google/Chrome):",
    },
    {
      expected: "Saved to work/screenshots/shot.png",
      name: "task-dir paths become task-relative",
      output: "Saved to /Users/jane/tasks/t1/work/screenshots/shot.png",
    },
    {
      expected: "in .",
      name: "a bare task-dir path becomes .",
      output: "in /Users/jane/tasks/t1",
    },
    {
      expected: "no paths here",
      name: "unrelated output is untouched",
      output: "no paths here",
    },
  ])("$name", ({ expected, output }) => {
    expect(scrubHostPaths(output, opts)).toBe(expected);
  });
});

describe("findSubcommand", () => {
  it.each([
    { args: ["open", "https://example.com"], expected: "open" },
    { args: ["--json", "snapshot", "-i"], expected: "snapshot" },
    // A value flag's value is never mistaken for the subcommand, even when it
    // collides with a blocked subcommand name.
    { args: ["--profile", "session", "open"], expected: "open" },
    { args: ["--cdp", "9222", "connect"], expected: "connect" },
    { args: ["--cdp=9222", "snapshot"], expected: "snapshot" },
    // Boolean flags consume only a literal true/false.
    { args: ["--auto-connect", "false", "snapshot"], expected: "snapshot" },
    { args: ["--auto-connect", "open", "x"], expected: "open" },
    { args: ["--headed", "true", "open"], expected: "open" },
    { args: ["--json"], expected: undefined },
  ])("finds $expected in $args", ({ args, expected }) => {
    expect(findSubcommand(args)).toBe(expected);
  });
});

describe("isExternalBrowserInvocation", () => {
  it.each([
    { args: ["open", "https://example.com"], external: false },
    { args: ["snapshot", "-i"], external: false },
    { args: ["--user-agent", "bot/1.0", "open", "x"], external: false },
    { args: ["--auto-connect", "open", "x"], external: true },
    { args: ["--auto-connect=false", "open", "x"], external: false },
    { args: ["--auto-connect", "false", "open", "x"], external: false },
    { args: ["--cdp", "9222", "snapshot"], external: true },
    { args: ["--cdp=ws://127.0.0.1:9222/x", "snapshot"], external: true },
    { args: ["--provider", "browserbase", "open", "x"], external: true },
    { args: ["--provider=ios", "open", "x"], external: true },
    { args: ["-p", "ios", "open", "x"], external: true },
    // Explicitly naming the instrument provider is the task browser.
    { args: ["--provider", "instrument", "open", "x"], external: false },
    { args: ["--provider=instrument", "open", "x"], external: false },
    { args: ["--profile", "Default", "open", "x"], external: true },
    { args: ["--state", "state.json", "open", "x"], external: true },
    { args: ["--restore", "shop", "open", "x"], external: true },
    { args: ["--executable-path", "/opt/chrome", "open", "x"], external: true },
    // A non-targeting value flag's value is never read as a flag itself.
    { args: ["--args", "--cdp", "open", "x"], external: false },
    { args: ["--user-agent", "--auto-connect", "open", "x"], external: false },
    // Upstream identity precedence: provider beats launch-state flags, cdp
    // beats provider.
    {
      args: ["--profile", "Default", "--provider", "instrument", "open"],
      external: false,
    },
    {
      args: ["--provider", "instrument", "--cdp", "9222", "get", "url"],
      external: true,
    },
  ])("$args -> external: $external", ({ args, external }) => {
    expect(isExternalBrowserInvocation(args)).toBe(external);
  });
});

describe("isDaemonConfigRace", () => {
  it("matches the CLI's daemon-configuration refusal", () => {
    expect(
      isDaemonConfigRace(
        "✗ A daemon for session 'ses_01KXTDQBA6YKA952V0XGVK2HM4' started " +
          "concurrently with different daemon configuration. Retry the command " +
          "so agent-browser can restart it with the requested configuration.",
      ),
    ).toBe(true);
  });

  it.each([
    ["✗ Navigation failed: net::ERR_FILE_NOT_FOUND"],
    ["✗ CDP error (Page.navigate): CDP command timed out: Page.navigate."],
    [""],
  ])("does not match unrelated failure %j", (output) => {
    expect(isDaemonConfigRace(output)).toBe(false);
  });
});
