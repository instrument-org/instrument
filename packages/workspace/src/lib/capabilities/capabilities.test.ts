import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import {
  type RecordedAppGuide,
  withAppGuideHandOffs,
} from "../apps/guide-hand-off";
import { runtimeLayout } from "../runtime-dir";
import { withRaisedAsks } from "../shell-commands/raised-asks";
import { cliSubcommands, generatedCommand } from "./cli";
import { type CapabilityScope, capabilityContexts } from "./context";
import { type Capability, CapabilityFailure, defineCapability } from "./define";
import { unavailableReason } from "./admit";
import { describeCapabilities, dispatch } from "./dispatch";
import { CAPABILITIES } from "./registry";
import { ensureInstrumentStub, INSTRUMENT_STUB_MESSAGE } from "./stub";
import { getWorkspaceConfig } from "../workspace-config";

const scope: CapabilityScope = {
  chatId: ChatIdSchema.parse("capabilities-test"),
  role: "task",
  sessionId: StoreId.newSessionId(),
};

/** Hands its input back, gated by `gate` on its `app`. */
const echo = defineCapability({
  gate: ({ app }) =>
    Promise.resolve(
      app === "closed"
        ? { kind: "refused", message: `"closed" is not connected.` }
        : app === "asks"
          ? {
              ask: { kind: "app", target: "asks" },
              kind: "ask",
              message: "using asks needs the person's yes.",
            }
          : app === "mac"
            ? { askId: "ask-1", kind: "card", message: "macOS is asking." }
            : app === "guided"
              ? {
                  guides: [{ app, guide: "# Guide\n\nPages are 25." }],
                  kind: "read-first",
                }
              : app === "both"
                ? {
                    guides: [
                      { app: "docs", guide: "# Docs\n\nPOST /documents." },
                      { app: "gmail", guide: "# Gmail\n\nDrafts only." },
                    ],
                    kind: "read-first",
                  }
                : { kind: "allowed" },
    ),
  input: z.object({
    app: z.string({ error: "an app slug is required." }),
    count: z.number().optional(),
    data: z.json().optional(),
    labels: z.array(z.string()).optional(),
    params: z.record(z.string(), z.string()).default({}),
    start_time: z.string().optional(),
    verbose: z.boolean().optional(),
  }),
  name: "test.echo",
  output: z.json(),
  run: (input) =>
    input.app === "broken"
      ? Promise.reject(new CapabilityFailure("the service said no."))
      : Promise.resolve(z.json().parse(input)),
  summary: "Hands its input back.",
  surfaces: {
    cli: {
      flagNames: { params: "param" },
      help: "For tests.",
      positional: ["app", "data"],
      stdin: "data",
      words: ["test", "echo"],
    },
    script: { positional: ["app"] },
  },
  text: (output) => JSON.stringify(output),
});

const chatOnly = defineCapability({
  input: z.object({}),
  name: "test.chat_only",
  output: z.object({}),
  run: () => Promise.resolve({}),
  summary: "Only the chat has it.",
  surfaces: { cli: { help: "", words: ["test", "chat-only"] }, script: {} },
  text: () => "",
  where: { roles: ["chat"] },
});

const cliOnly = defineCapability({
  input: z.object({}),
  name: "test.cli_only",
  output: z.object({}),
  run: () => Promise.resolve({}),
  summary: "Never in a script.",
  surfaces: { cli: { help: "", words: ["test", "cli-only"] } },
  text: () => "done",
});

/** Declares its fields in camelCase, as a model tool's capability does. */
const camel = defineCapability({
  input: z.object({ maxCharacters: z.number().optional(), url: z.string() }),
  name: "test.camel",
  output: z.json(),
  run: (input) => Promise.resolve(z.json().parse(input)),
  summary: "Hands its input back.",
  surfaces: { script: { positional: ["url"] } },
  text: (output) => JSON.stringify(output),
});

/** Fails by its render, as `app test` does. */
const failing = defineCapability({
  input: z.object({}),
  name: "test.failing",
  output: z.object({ passed: z.boolean() }),
  render: () => ({ exitCode: 1, stderr: "failed\n", stdout: "" }),
  run: () => Promise.resolve({ passed: false }),
  summary: "Always fails.",
  surfaces: { cli: { help: "", words: ["test", "failing"] } },
  text: () => "failed",
});

const REGISTRY: readonly Capability[] = [
  echo,
  camel,
  chatOnly,
  cliOnly,
  failing,
];

async function cli(args: string[], stdin = "") {
  const command = generatedCommand(
    {
      name: "instrument test",
      scope,
      usage: (lines) => lines.join("\n"),
      word: "test",
    },
    REGISTRY,
  );
  const fs = new InMemoryFs();
  const recorded: RecordedAppGuide[] = [];
  const asks: string[] = [];
  const result = await withRaisedAsks(asks, () =>
    withAppGuideHandOffs(recorded, () =>
      command.execute(
        args,
        createCommandContext({
          cwd: "/work",
          env: new Map(),
          fs,
          stdin: stdin ? encodeUtf8ToBytes(stdin) : EMPTY_BYTES,
        }),
      ),
    ),
  );
  return { asks, fs, recorded, ...result };
}

describe("the generated command line", () => {
  it("reads positional words, typed flags, repeated flags and pairs", async () => {
    const result = await cli([
      "echo",
      "beacon",
      '{"a":1}',
      "--count",
      "3",
      "--labels",
      "bug",
      "--labels",
      "ui",
      "--param",
      "state=open",
      "--start-time",
      "today",
      "--verbose",
    ]);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      app: "beacon",
      count: 3,
      data: { a: 1 },
      labels: ["bug", "ui"],
      params: { state: "open" },
      start_time: "today",
      verbose: true,
    });
  });

  it("takes a JSON field from stdin, and text where it is not JSON", async () => {
    expect(
      JSON.parse((await cli(["echo", "beacon"], '{"from":"stdin"}')).stdout),
    ).toMatchObject({ data: { from: "stdin" } });
    expect(
      JSON.parse((await cli(["echo", "beacon", "plain words"])).stdout),
    ).toMatchObject({ data: "plain words" });
    expect(
      JSON.parse((await cli(["echo", "beacon", '"quoted"'])).stdout),
    ).toMatchObject({ data: '"quoted"' });
  });

  it("prints the whole result with --json, and writes it with --out", async () => {
    expect((await cli(["echo", "beacon", "--json"])).stdout).toBe(
      '{"app":"beacon","params":{}}\n',
    );
    const written = await cli(["echo", "beacon", "--out", "out.json"]);
    expect(written.stdout).toMatchInlineSnapshot(`
      "Wrote out.json: JSON, an object with keys "app", "params", 28 bytes.
      "
    `);
    expect(await written.fs.readFile("/work/out.json")).toBe(
      '{"app":"beacon","params":{}}\n',
    );
    const json = await cli(["cli-only", "--json", "--out", "out.json"]);
    expect(await json.fs.readFile("/work/out.json")).toBe("{}\n");
  });

  it.each([[["--json"]], [["--out", "out.txt"]], [[]]])(
    "keeps a rendered failure's exit code with %j",
    async (flags) => {
      expect((await cli(["failing", ...flags])).exitCode).toBe(1);
    },
  );

  it.each([
    ["closed", 1, 'instrument test: "closed" is not connected.\n'],
    ["asks", 1, "instrument test: using asks needs the person's yes.\n"],
    ["mac", 2, "macOS is asking.\n"],
    ["broken", 1, "instrument test: the service said no.\n"],
  ])("answers a call to %s with exit %d", async (app, exitCode, stderr) => {
    const result = await cli(["echo", app]);
    expect(result).toMatchObject({ exitCode, stderr, stdout: "" });
  });

  it.each([[[]], [["help"]], [["echo", "--help"]], [["-h"]]])(
    "prints the usage for %j",
    async (args) => {
      const result = await cli(args);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/^ {2}instrument test echo /);
    },
  );

  it("refuses a subcommand it does not have, with the usage", async () => {
    const result = await cli(["frob"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(
      /^instrument test: unknown subcommand "frob"\.\n\n {2}instrument test echo /,
    );
  });

  it("refuses an unknown flag with the one form it takes", async () => {
    const result = await cli(["cli-only", "--nope"]);
    expect(result.stderr).toMatchInlineSnapshot(`
      "instrument test: unknown flag --nope on \`instrument test cli-only\`.

        instrument test cli-only
            Never in a script.
      "
    `);
  });

  it("raises the card a gate says is up", async () => {
    expect((await cli(["echo", "mac"])).asks).toEqual(["ask-1"]);
  });

  it("sends nothing before the guide is read: the guide on stderr, exit 3, the hand-off recorded", async () => {
    const result = await cli(["echo", "guided"]);
    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatchInlineSnapshot(`
      "Not sent (exit 3): before the first request to "guided", its guide. Read it, then repeat the request. A guide counts as read only where its output is shown: this one, or \`instrument app guide <slug>\` printed whole. One sent to /dev/null or cut with head does not count, and the next request stops here again.

      # Guide

      Pages are 25.
      "
    `);
    expect(result.recorded).toEqual([
      expect.objectContaining({ app: "guided", printed: result.stderr }),
    ]);
  });

  it("says what the schema says of a missing field", async () => {
    const result = await cli(["echo"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("instrument test: an app slug is required.\n");
  });

  it("lists each capability in the usage from its schema", async () => {
    expect((await cli(["help"])).stdout).toMatchInlineSnapshot(`
      "  instrument test echo <app> ['<data>'] [--count <count>] [--labels <labels>]... [--param <key>=<value>]... [--start-time <start-time>] [--verbose] [<<'EOF' ... EOF]
            Hands its input back.
            For tests.
        instrument test chat-only
            Only the chat has it.
        instrument test cli-only
            Never in a script.
        instrument test failing
            Always fails."
    `);
  });
});

describe("dispatch", () => {
  const script = capabilityContexts(scope, "script")();

  it("gives a script's camelCase field the name the capability declares", async () => {
    const answer = await dispatch(
      "test.echo",
      { app: "beacon", startTime: "today" },
      script,
      REGISTRY,
    );
    expect(answer).toMatchObject({ output: { start_time: "today" } });
  });

  it("gives a Python script's snake_case field the camelCase name a tool's capability declares", async () => {
    const answer = await dispatch(
      "test.camel",
      { max_characters: 5, url: "https://example.com" },
      script,
      REGISTRY,
    );
    expect(answer).toMatchObject({
      output: { maxCharacters: 5, url: "https://example.com" },
    });
  });

  it("frames the guide for a script, which runs again rather than repeating a command", async () => {
    const answer = await dispatch(
      "test.echo",
      { app: "guided" },
      script,
      REGISTRY,
    );
    expect(answer).toMatchObject({
      error: {
        kind: "read-first",
        message: expect.stringMatching(/^Not sent: .* run the script again\./),
      },
    });
  });

  it("hands every guide in the error over in one, each recorded", async () => {
    const recorded: RecordedAppGuide[] = [];
    const answer = await withAppGuideHandOffs(recorded, () =>
      dispatch("test.echo", { app: "both" }, script, REGISTRY),
    );
    expect("error" in answer && answer.error.message).toMatchInlineSnapshot(`
      "Not sent: before the first request to "docs" and "gmail", the connected API apps whose guides are not read yet. Read them, then run the script again. A guide counts as read only where its output is shown: this one, or \`instrument app guide <slug>\` printed whole. One sent to /dev/null or cut with head does not count, and the next request stops here again.

      --- the guide to "docs" ---

      # Docs

      POST /documents.

      --- the guide to "gmail" ---

      # Gmail

      Drafts only.
      "
    `);
    expect(recorded.map(({ app }) => app)).toEqual(["docs", "gmail"]);
  });

  it("refuses a call once its command is stopped, with nothing run", async () => {
    const stop = new AbortController();
    stop.abort();
    const stopped = capabilityContexts(scope, "script")(stop.signal);
    expect(await dispatch("test.echo", { app: "beacon" }, stopped, REGISTRY))
      .toMatchInlineSnapshot(`
      {
        "error": {
          "kind": "refused",
          "message": "The command was stopped, so instrument takes no more calls from it.",
        },
      }
    `);
  });

  it("refuses what the shell's role does not have", async () => {
    expect(await dispatch("test.chat_only", {}, script, REGISTRY))
      .toMatchInlineSnapshot(`
      {
        "error": {
          "kind": "refused",
          "message": "only the chat has test.chat_only. Say in your report what the chat should do with it.",
        },
      }
    `);
  });

  it("keeps a capability off the surface it is not on", async () => {
    expect(await dispatch("test.cli_only", {}, script, REGISTRY)).toEqual({
      error: {
        kind: "failed",
        message: 'there is no capability "test.cli_only".',
      },
    });
  });

  it("describes only what a script in this shell may call", () => {
    expect(
      describeCapabilities(script, REGISTRY).map(({ name, positional }) => ({
        name,
        positional,
      })),
    ).toEqual([
      { name: "test.echo", positional: ["app"] },
      { name: "test.camel", positional: ["url"] },
    ]);
  });
});

describe("the registry", () => {
  const script = capabilityContexts(scope, "script")();

  // Setting an app up is the agent's own step, with its output in front of
  // it, and the turn-enders are model tools that end the turn: neither is a
  // script's to call. Neither is keeping a memory, changing what is in front
  // of the person, or starting and steering tasks. Reads and the web and
  // image tools are.
  it("puts reads and the web and image tools on the script surface, and app setup off it", () => {
    expect(
      describeCapabilities(script)
        .map(({ name }) => name)
        .toSorted(),
    ).toMatchInlineSnapshot(`
      [
        "apps.call",
        "apps.list",
        "apps.read",
        "apps.request",
        "apps.resources",
        "apps.tools",
        "images.generate",
        "memory.list",
        "memory.show",
        "web.fetch",
        "web.search",
        "window.list",
        "window.read",
        "x.search",
        "x.thread",
      ]
    `);
  });

  it("gives a task's script the reads alone", () => {
    expect(
      describeCapabilities(
        capabilityContexts({ ...scope, role: "task" }, "script")(),
      )
        .map(({ name }) => name)
        .toSorted(),
    ).toMatchInlineSnapshot(`
      [
        "apps.call",
        "apps.list",
        "apps.read",
        "apps.request",
        "apps.resources",
        "apps.tools",
        "images.generate",
        "memory.list",
        "memory.show",
        "web.fetch",
        "web.search",
        "window.list",
        "window.read",
        "x.search",
        "x.thread",
      ]
    `);
  });

  // The chat's and a task's shells differ only by these: a task reads the
  // window and the memories, and changes neither, and has no tasks.
  it("leaves out of a task what only the chat has, each saying what to do instead", () => {
    expect(
      Object.fromEntries(
        CAPABILITIES.flatMap((capability) => {
          const refused = unavailableReason(capability, "task");
          return refused === undefined ? [] : [[capability.name, refused]];
        }),
      ),
    ).toMatchInlineSnapshot(`
      {
        "apps.disconnect": "only the chat sets up and changes apps, since every chat uses them. End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on.",
        "apps.icon": "only the chat sets up and changes apps, since every chat uses them. End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on.",
        "apps.new": "only the chat sets up and changes apps, since every chat uses them. End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on.",
        "apps.test": "only the chat sets up and changes apps, since every chat uses them. End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on.",
        "memory.forget": "only the chat saves and forgets memories. Say in your report what the chat should remember or forget.",
        "memory.save": "only the chat saves and forgets memories. Say in your report what the chat should remember or forget.",
        "task.list": "only the chat starts and steers tasks. Do the work here, and say in your report what is left.",
        "task.log": "only the chat starts and steers tasks. Do the work here, and say in your report what is left.",
        "task.new": "only the chat starts and steers tasks. Do the work here, and say in your report what is left.",
        "task.send": "only the chat starts and steers tasks. Do the work here, and say in your report what is left.",
        "task.stop": "only the chat starts and steers tasks. Do the work here, and say in your report what is left.",
        "window.close": "only the chat changes the window. To open a page to work in, use \`agent-browser tab new <url>\`; say in your report what the chat should show.",
        "window.request": "only the chat changes the window. To open a page to work in, use \`agent-browser tab new <url>\`; say in your report what the chat should show.",
        "window.show": "only the chat changes the window. To open a page to work in, use \`agent-browser tab new <url>\`; say in your report what the chat should show.",
      }
    `);
  });

  it("generates every instrument subcommand", () => {
    expect(
      Object.fromEntries(
        ["app", "memory", "task", "window", "x"].map((word) => [
          word,
          Object.keys(cliSubcommands(word).subcommands).toSorted(),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "app": [
          "account",
          "call",
          "catalog",
          "disconnect",
          "guide",
          "icon",
          "list",
          "new",
          "read",
          "request",
          "resources",
          "test",
          "tool",
          "tools",
        ],
        "memory": [
          "forget",
          "list",
          "save",
          "show",
        ],
        "task": [
          "list",
          "log",
          "new",
          "send",
          "stop",
        ],
        "window": [
          "close",
          "list",
          "read",
          "request",
          "show",
        ],
        "x": [
          "search",
          "thread",
        ],
      }
    `);
  });
});

describe.skipIf(process.platform === "win32")("the instrument program", () => {
  it("tells a script that runs it how to reach instrument, and exits 127", async () => {
    await ensureInstrumentStub();
    const result = spawnSync(
      path.join(
        runtimeLayout(getWorkspaceConfig().runtimeDir).bin,
        "instrument",
      ),
      ["app", "list"],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(127);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${INSTRUMENT_STUB_MESSAGE}\n`);
  });
});
