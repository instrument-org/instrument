import { afterEach, describe, expect, it, vi } from "vitest";

import { claudeCodeEnvironment } from "./environment";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("claudeCodeEnvironment", () => {
  // Each one, set in the person's shell, runs Claude Code on something other
  // than the account Instrument signed in, or overrides what a request asks.
  it.each([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_SIMPLE",
    "CLAUDE_CODE_EFFORT_LEVEL",
    "MCP_TOOL_TIMEOUT",
  ])("leaves out %s from the shell", (name) => {
    vi.stubEnv(name, "1");
    vi.stubEnv("INSTRUMENT_KEPT", "yes");
    const env = claudeCodeEnvironment(undefined);
    expect(env).not.toHaveProperty(name);
    expect(env.INSTRUMENT_KEPT).toBe("yes");
  });

  it("turns Claude Code's own features off whatever the shell sets", () => {
    vi.stubEnv("ENABLE_TOOL_SEARCH", "true");
    vi.stubEnv("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "0");
    vi.stubEnv("DISABLE_AUTO_COMPACT", "0");
    const env = claudeCodeEnvironment("/config");
    expect({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: env.CLAUDE_CODE_DISABLE_AUTO_MEMORY,
      CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR,
      DISABLE_AUTO_COMPACT: env.DISABLE_AUTO_COMPACT,
      ENABLE_TOOL_SEARCH: env.ENABLE_TOOL_SEARCH,
    }).toEqual({
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CONFIG_DIR: "/config",
      DISABLE_AUTO_COMPACT: "1",
      ENABLE_TOOL_SEARCH: "false",
    });
  });
});
