import { describe, expect, it } from "vitest";

import {
  agentBrowserFlagName,
  parseAgentBrowserArgs,
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
    // The CLI reads the first surviving token as the command, flag or not.
    { args: ["--raw", "read", "url"], expected: "--raw" },
    { args: [], expected: undefined },
  ])("reads the subcommand of $args as $expected", ({ args, expected }) => {
    expect(parseAgentBrowserArgs(args).subcommand).toBe(expected);
  });

  it("keeps each sub-argument's index in the original list", () => {
    const result = parseAgentBrowserArgs([
      "--headers",
      "{}",
      "open",
      "/task/output/report.html",
    ]);

    expect(result.subArgs).toMatchInlineSnapshot(`
      [
        {
          "index": 2,
          "value": "open",
        },
        {
          "index": 3,
          "value": "/task/output/report.html",
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
