import { describe, expect, it } from "vitest";

import { classifyInvocation } from "./agent-browser";
import {
  agentBrowserFlagName,
  GLOBAL_BOOL_FLAGS,
  GLOBAL_VALUE_FLAGS,
  parseAgentBrowserArgs,
  RESTORE_FLAG,
} from "./agent-browser-args";
import {
  AGENT_BROWSER_COMMAND_HELP,
  AGENT_BROWSER_HELP,
} from "./agent-browser-cli-output.generated";
import type { FileCommand } from "./agent-browser-cli-recording";

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
    expect(result.endOfOptions).toBe(2);
  });

  it.each([
    { args: ["open", "example.com"], endOfOptions: 2 },
    // A value flag's value, as the CLI reads it.
    { args: ["--user-agent", "--", "open"], endOfOptions: 3 },
    { args: ["--user-agent", "--", "open", "--", "x"], endOfOptions: 3 },
    { args: ["type", "@e1", "--", "a", "--", "b"], endOfOptions: 2 },
  ])("ends the options of $args at $endOfOptions", ({ args, endOfOptions }) => {
    expect(parseAgentBrowserArgs(args).endOfOptions).toBe(endOfOptions);
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

const help = AGENT_BROWSER_HELP;

// A global flag the model does not know is read as the command, or lets its
// value be, so a blocked command passes as an allowed one. The CLI lists its
// global flags in its recorded `--help`, under every heading but the one for
// `snapshot`'s own; one it gains fails here until it is in the tables, and the
// wrapper's own test of what it does with each flag then asks for a decision.
describe("the tables of global flags", () => {
  const listed = [...flagLinesOf(help, ["Snapshot Options:"])].map((line) => {
    const [, flag = "", operand] =
      /^ {2}(?:-\w, )?(--[a-z-]+)(?:, -\w)?(?: ([<[]))?/.exec(line) ?? [];
    return { flag, operand };
  });

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

// A command is allowed unless the wrapper refuses it, so one the CLI gains
// arrives allowed. Every command the recorded `--help` names is decided
// here: a new one changes the snapshot, and is refused in BLOCKED_SUBCOMMANDS
// where it manages the browser itself, sessions, saved state, credentials,
// installs, plugins or a connection outside the app. The decision is the one
// for the bare command, so `tab` passes though `tab keep` is refused.
describe("the commands the CLI takes", () => {
  // The help names no alias and leaves some commands out. These are the rest
  // of `is_top_level_command` in the CLI's source (cli/src/commands.rs) at
  // 0.44.0, which no test can read from the binary: one added there and left
  // out of the help is not seen here.
  const unlisted = [
    "dialog",
    "exit",
    "frame",
    "goto",
    "key",
    "keydown",
    "keyup",
    "navigate",
    "plugins",
    "quit",
    "scrollinto",
    "web-vitals",
    "window",
  ];
  const listed = commandsListedIn(help);

  it("reads commands out of the CLI's help", () => {
    expect(listed.size).toBeGreaterThan(60);
    expect(unlisted.filter((name) => listed.has(name))).toEqual([]);
  });

  it("decides what each command is", () => {
    const decisions = Object.fromEntries(
      [...listed, ...unlisted]
        .toSorted()
        .map((name) => [
          name,
          classifyInvocation([name], { hasNoWindow: false }).kind,
        ]),
    );
    expect(decisions).toMatchInlineSnapshot(`
      {
        "a11y": "tabs",
        "auth": "refuse",
        "back": "tabs",
        "batch": "refuse",
        "chat": "refuse",
        "check": "tabs",
        "click": "tabs",
        "clipboard": "tabs",
        "close": "refuse",
        "confirm": "refuse",
        "connect": "refuse",
        "console": "tabs",
        "cookies": "tabs",
        "dashboard": "refuse",
        "dblclick": "tabs",
        "deny": "refuse",
        "device": "refuse",
        "dialog": "tabs",
        "diff": "tabs",
        "doctor": "refuse",
        "download": "tabs",
        "drag": "tabs",
        "errors": "tabs",
        "eval": "tabs",
        "exit": "refuse",
        "fill": "tabs",
        "find": "tabs",
        "flow": "refuse",
        "focus": "tabs",
        "forward": "tabs",
        "frame": "tabs",
        "get": "tabs",
        "goto": "tabs",
        "highlight": "tabs",
        "hover": "tabs",
        "inspect": "refuse",
        "install": "refuse",
        "is": "tabs",
        "key": "tabs",
        "keyboard": "tabs",
        "keydown": "tabs",
        "keyup": "tabs",
        "mcp": "refuse",
        "mouse": "tabs",
        "navigate": "tabs",
        "network": "tabs",
        "open": "tabs",
        "pdf": "tabs",
        "plugin": "refuse",
        "plugins": "refuse",
        "press": "tabs",
        "profiler": "tabs",
        "profiles": "refuse",
        "pushstate": "tabs",
        "quit": "refuse",
        "react": "tabs",
        "read": "tabs",
        "record": "tabs",
        "reload": "tabs",
        "removeinitscript": "tabs",
        "screenshot": "tabs",
        "scroll": "tabs",
        "scrollinto": "tabs",
        "scrollintoview": "tabs",
        "select": "tabs",
        "session": "refuse",
        "set": "tabs",
        "skills": "skills",
        "snapshot": "tabs",
        "state": "refuse",
        "storage": "tabs",
        "stream": "refuse",
        "swipe": "tabs",
        "tab": "tabs",
        "tap": "tabs",
        "trace": "tabs",
        "type": "tabs",
        "uncheck": "tabs",
        "upgrade": "refuse",
        "upload": "tabs",
        "vitals": "tabs",
        "wait": "tabs",
        "web-vitals": "tabs",
        "webmcp": "tabs",
        "window": "refuse",
      }
    `);
  });
});

// The wrapper finds these commands' file by knowing their own flags, and
// refuses one it does not know. A flag the CLI gains fails here once its help
// is recorded: add it to `fileOperandsOf`, or it stays refused, or its value
// is taken for the file. `network` lists flags that belong to its other operations.
describe("the flags of the commands that name a file", () => {
  it.each([
    ["screenshot", ["--full", "--if-changed", "--threshold"]],
    ["pdf", []],
    ["download", []],
    ["trace", []],
    ["profiler", ["--categories"]],
    [
      "record",
      ["--fps", "--cursor", "--contact-sheet", "--contact-sheet-threshold"],
    ],
    [
      "network",
      [
        "--abort",
        "--body",
        "--allow-origin",
        "--clear",
        "--filter",
        "--type",
        "--method",
        "--status",
        "--content",
      ],
    ],
  ] satisfies [FileCommand, string[]][])(
    "%s has the ones the wrapper reads",
    (command, known) => {
      const own = [
        ...(AGENT_BROWSER_COMMAND_HELP[command]
          .split("\nExamples:")[0]
          ?.matchAll(/^ +(?:-\w, )?(--[a-z-]+)/gm) ?? []),
      ].flatMap(([, flag]) =>
        flag === undefined ||
        GLOBAL_VALUE_FLAGS.has(flag) ||
        GLOBAL_BOOL_FLAGS.has(flag)
          ? []
          : [flag],
      );
      expect(own).toEqual(known);
    },
  );
});

/** The global flag lines of the CLI's help, under every heading but `skipped`. */
function* flagLinesOf(text: string, skipped: string[]) {
  let inSection = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inSection = !skipped.includes(line.trim());
    } else if (inSection && /^ {2}-/.test(line)) {
      yield line;
    }
  }
}

/**
 * The commands the CLI's help names, in the three ways it names one: a heading
 * that carries the command (`Get Info:  agent-browser get <what>`, whose lines
 * are that command's own words), a line that lists it with its operands, and a
 * call written out in an example.
 */
function commandsListedIn(text: string) {
  const names = new Set<string>();
  let headingNamesCommand = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      const [, named] = /:\s+agent-browser ([a-z][\w-]*)/.exec(line) ?? [];
      headingNamesCommand = named !== undefined;
      if (named) {
        names.add(named);
      }
      continue;
    }
    const [, calls] = /^(?:\w+: )?agent-browser (.*)$/.exec(line.trim()) ?? [];
    if (calls !== undefined) {
      for (const call of (calls.split(" #")[0] ?? "").split("&&")) {
        // A bare `--restore` takes the command after it as its key in the
        // wrapper's reading, which the CLI's does not.
        const words = (call.match(/"[^"]*"|\S+/g) ?? []).filter(
          (word) => word !== RESTORE_FLAG,
        );
        const { subcommand } = parseAgentBrowserArgs(
          words[0] === "agent-browser" ? words.slice(1) : words,
        );
        if (subcommand) {
          names.add(subcommand);
        }
      }
      continue;
    }
    if (headingNamesCommand) {
      continue;
    }
    // Prose is indented like a listing: a listing is the command alone, or
    // sets its description off in a column, or follows the command with an
    // operand (`<sel>`, `[url]`, `start|stop`).
    const [, name, rest = ""] =
      /^ {2}([a-z][\w-]*)(?: (.*))?$/.exec(line) ?? [];
    const [usage = "", description] = rest.split(/ {2,}/);
    if (
      name &&
      !description?.startsWith("#") &&
      (rest === "" ||
        description !== undefined ||
        /^[<["]|\|/.test(usage.split(" ")[0] ?? ""))
    ) {
      names.add(name);
    }
  }
  return names;
}
