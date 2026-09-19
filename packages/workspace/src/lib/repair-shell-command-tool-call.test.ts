import { describe, expect, it } from "vitest";

import { shellCommandFromToolName } from "./repair-shell-command-tool-call";

const withBash = ["bash", "choose", "connect_app", "request_folder"];

function repair(toolName: string, availableToolNames = withBash) {
  return shellCommandFromToolName({ availableToolNames, toolName });
}

describe("shellCommandFromToolName", () => {
  it("turns a command called as a tool into the command itself", () => {
    expect(repair("memory save pacific-time")).toBe("memory save pacific-time");
    expect(repair("task new --name 'Kettles'")).toBe(
      "task new --name 'Kettles'",
    );
    expect(repair("app call linear list_issues")).toBe(
      "app call linear list_issues",
    );
    expect(repair("chat threads -n 5")).toBe("chat threads -n 5");
  });

  it("takes a whole script, which is the failure it exists for", () => {
    const script = `memory save pacific-time-morning-calls <<'EOF'\nYou are on Pacific time.\nEOF`;

    expect(repair(script)).toBe(script);
  });

  it("leaves a bare command alone, since its arguments are not recoverable", () => {
    expect(repair("memory")).toBeUndefined();
    expect(repair("task")).toBeUndefined();
  });

  it("leaves a tool that is simply not ours alone", () => {
    expect(repair("web_search")).toBeUndefined();
    expect(repair("memorize the user's time zone")).toBeUndefined();
    expect(repair("")).toBeUndefined();
    expect(repair("   ")).toBeUndefined();
  });

  it("does nothing for an agent with no bash tool to route it to", () => {
    expect(repair("memory save x", ["choose", "read_file"])).toBeUndefined();
  });

  it("refuses a name too long to be one", () => {
    expect(repair(`memory save ${"x".repeat(4000)}`)).toBeUndefined();
  });
});
