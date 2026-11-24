import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { agentBrowserPath } from "../agent-browser";
import {
  agentBrowserFlagName,
  GLOBAL_BOOL_FLAGS,
  GLOBAL_VALUE_FLAGS,
  parseAgentBrowserArgs,
  RESTORE_FLAG,
} from "./agent-browser-args";

describe("agentBrowserFlagName", () => {
  it.each([
    { arg: "--cdp", expected: "--cdp" },
    { arg: "--cdp=9222", expected: "--cdp" },
    { arg: "-p", expected: "--provider" },
    { arg: "-q", expected: "--quiet" },
    { arg: "open", expected: "open" },
    { arg: "@e1", expected: "@e1" },
  ])("resolves $arg to $expected", ({ arg, expected }) => {
    expect(agentBrowserFlagName(arg)).toBe(expected);
  });
});

describe("parseAgentBrowserArgs", () => {
  it.each([
    // A global flag's value is not the subcommand.
    { args: ["--headers", "{}", "close"], expected: "close" },
    { args: ["--max-output", "500", "read", "url"], expected: "read" },
    { args: ["-p", "browserbase", "open", "url"], expected: "open" },
    // Globals are pulled out wherever they appear.
    { args: ["open", "url", "--cdp", "9222"], expected: "open" },
    // A bool global only swallows a literal true/false.
    { args: ["--json", "snapshot"], expected: "snapshot" },
    { args: ["--headed", "true", "snapshot"], expected: "snapshot" },
    { args: ["--headed", "snapshot"], expected: "snapshot" },
    // A flag this model does not know lets the word after it be read as the
    // command, so each of these is one the CLI takes a value for.
    { args: ["--input-mode", "human", "close"], expected: "close" },
    { args: ["--capture", "flow", "close"], expected: "close" },
    { args: ["--cdp-headers", "{}", "close"], expected: "close" },
    { args: ["--ca-cert", "ca.pem", "close"], expected: "close" },
    { args: ["--relaunch", "--pin-tab", "close"], expected: "close" },
    // The CLI reads the first surviving token as the command, flag or not.
    { args: ["--raw", "read", "url"], expected: "--raw" },
    { args: ["--", "close"], expected: "--" },
    { args: [], expected: undefined },
  ])("reads the subcommand of $args as $expected", ({ args, expected }) => {
    expect(parseAgentBrowserArgs(args).subcommand).toBe(expected);
  });

  it("reads --state after wait as the element state the command takes", () => {
    const result = parseAgentBrowserArgs([
      "--json",
      "wait",
      "#spinner",
      "--state",
      "hidden",
    ]);

    expect(result.globalFlags.map(({ name }) => name)).toEqual(["--json"]);
    expect(result.subArgs.map(({ value }) => value)).toEqual([
      "wait",
      "#spinner",
      "--state",
      "hidden",
    ]);
  });

  it("reads --state ahead of wait, or with another command, as the state file", () => {
    for (const args of [
      ["--state", "auth.json", "wait", "#spinner"],
      ["open", "example.com", "--state", "auth.json"],
    ]) {
      expect(parseAgentBrowserArgs(args).globalFlags).toEqual([
        expect.objectContaining({ name: "--state", value: "auth.json" }),
      ]);
    }
  });

  it("reads everything from -- on as the command's own words", () => {
    const result = parseAgentBrowserArgs([
      "fill",
      "@e1",
      "--",
      "--json",
      "--cdp",
      "9222",
    ]);

    expect(result.globalFlags).toEqual([]);
    expect(result.subArgs.map(({ value }) => value)).toEqual([
      "fill",
      "@e1",
      "--",
      "--json",
      "--cdp",
      "9222",
    ]);
  });

  it("keeps each sub-argument's index in the original list", () => {
    const result = parseAgentBrowserArgs([
      "--headers",
      "{}",
      "open",
      "/Users/sam/chat/output/report.html",
    ]);

    expect(result.subArgs).toMatchInlineSnapshot(`
      [
        {
          "index": 2,
          "value": "open",
        },
        {
          "index": 3,
          "value": "/Users/sam/chat/output/report.html",
        },
      ]
    `);
  });

  it("reports the globals it consumed, with aliases resolved", () => {
    const result = parseAgentBrowserArgs([
      "-p",
      "browserbase",
      "--json",
      "read",
      "https://example.com",
    ]);

    expect(result.globalFlags).toMatchInlineSnapshot(`
      [
        {
          "name": "--provider",
          "value": "browserbase",
          "valueIndex": 1,
        },
        {
          "name": "--json",
          "value": undefined,
        },
      ]
    `);
  });

  // The bare form takes a following token as its key even where the CLI would
  // recognize that token as a command, which is only reachable on a --restore
  // the wrapper has already rejected.
  it.each([
    {
      args: ["--restore=work", "open", "url"],
      key: "work",
      subcommand: "open",
    },
    {
      args: ["--restore", "work", "open", "url"],
      key: "work",
      subcommand: "open",
    },
    { args: ["--restore", "open", "url"], key: "open", subcommand: "url" },
  ])("takes $key as the restore key of $args", ({ args, key, subcommand }) => {
    const result = parseAgentBrowserArgs(args);

    expect(result.globalFlags).toEqual([{ name: "--restore", value: key }]);
    expect(result.subcommand).toBe(subcommand);
  });
});

// A global flag the model does not know is read as the command, or lets its
// value be, so a blocked command passes as an allowed one. The installed CLI
// lists its global flags under two headings of `--help`; one it gains fails
// here until it is in the tables, and the wrapper's own test of what it does
// with each flag then asks for a decision.
describe("the tables of global flags", () => {
  const help = execFileSync(agentBrowserPath(), ["--help"], {
    encoding: "utf8",
  });
  const listed = [...sectionsOf(help, ["Authentication:", "Options:"])].map(
    (line) => {
      const [, flag = "", operand] =
        /^ {2}(?:-\w, )?(--[a-z-]+)(?:, -\w)?(?: ([<[]))?/.exec(line) ?? [];
      return { flag, operand };
    },
  );

  it("reads flags out of the CLI's help", () => {
    expect(listed.length).toBeGreaterThan(40);
    expect(listed.map(({ flag }) => flag)).toContain("--cdp");
  });

  it.each(listed)("knows $flag", ({ flag, operand }) => {
    // Printed and answered before any command is read.
    if (flag === "--version" || flag === "--help") {
      return;
    }
    // `--restore [name]` takes a value only when one follows, and
    // `--hide-scrollbars <bool>` is a switch that takes true or false.
    if (flag === RESTORE_FLAG) {
      return;
    }
    const takesValue = operand === "<" && flag !== "--hide-scrollbars";
    expect({
      flag,
      table: GLOBAL_VALUE_FLAGS.has(flag)
        ? "value"
        : GLOBAL_BOOL_FLAGS.has(flag)
          ? "switch"
          : "missing",
    }).toEqual({ flag, table: takesValue ? "value" : "switch" });
  });
});

/** The option lines under the named headings of the CLI's help. */
function* sectionsOf(help: string, headings: string[]) {
  let inSection = false;
  for (const line of help.split("\n")) {
    if (/^\S/.test(line)) {
      inSection = headings.includes(line.trim());
    } else if (inSection && /^ {2}-/.test(line)) {
      yield line;
    }
  }
}
