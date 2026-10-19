import { describe, expect, it } from "vitest";

import { shellCommandFromToolName } from "./repair-shell-command-tool-call";

const withBash = ["bash", "choose", "connect_app", "request_folder"];

function repair(toolName: string, availableToolNames = withBash) {
  return shellCommandFromToolName({ availableToolNames, toolName });
}

describe("shellCommandFromToolName", () => {
  it("turns a command called as a tool into the command itself", () => {
    expect(repair("instrument memory save pacific-time")).toBe(
      "instrument memory save pacific-time",
    );
    expect(repair("instrument task new --name 'Kettles'")).toBe(
      "instrument task new --name 'Kettles'",
    );
    expect(repair("instrument app call linear list_issues")).toBe(
      "instrument app call linear list_issues",
    );
  });

  it("takes a whole script, which is the failure it exists for", () => {
    const script = `instrument memory save pacific-time-morning-calls <<'EOF'\nYou are on Pacific time.\nEOF`;

    expect(repair(script)).toBe(script);
  });

  it("leaves a bare command alone, since its arguments are not recoverable", () => {
    expect(repair("instrument")).toBeUndefined();
    expect(repair("instrument memory")).toBeUndefined();
    expect(repair("instrument task")).toBeUndefined();
  });

  it("leaves a tool that is simply not ours alone", () => {
    expect(repair("web_search")).toBeUndefined();
    expect(repair("memory save pacific-time")).toBeUndefined();
    expect(repair("instrument the user's time zone")).toBeUndefined();
    expect(repair("")).toBeUndefined();
    expect(repair("   ")).toBeUndefined();
  });

  it("does nothing for an agent with no bash tool to route it to", () => {
    expect(
      repair("instrument memory save x", ["choose", "read_file"]),
    ).toBeUndefined();
  });

  it("refuses a name too long to be one", () => {
    expect(
      repair(`instrument memory save ${"x".repeat(4000)}`),
    ).toBeUndefined();
  });
});
