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
import { defineSubcommands } from "../shell-commands/subcommands";
import { cliSubcommands } from "./cli";
import { type CapabilityScope, capabilityContexts } from "./context";
import { type Capability, CapabilityFailure, defineCapability } from "./define";
import { describeCapabilities, dispatch } from "./dispatch";
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

const REGISTRY: readonly Capability[] = [echo, chatOnly, cliOnly];

async function cli(args: string[], stdin = "") {
  const { subcommands, usage } = cliSubcommands("test", REGISTRY);
  const run = defineSubcommands({
    errorPrefix: "subcommand",
    name: "instrument test",
    subcommands,
    usage: usage.join("\n"),
  });
  const fs = new InMemoryFs();
  const recorded: RecordedAppGuide[] = [];
  const asks: string[] = [];
  const result = await withRaisedAsks(asks, () =>
    withAppGuideHandOffs(recorded, () =>
      run(
        args,
        scope,
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

  it.each([
    ["closed", 1, 'instrument test echo: "closed" is not connected.\n'],
    ["asks", 1, "instrument test echo: using asks needs the person's yes.\n"],
    ["mac", 2, "macOS is asking.\n"],
    ["broken", 1, "instrument test echo: the service said no.\n"],
  ])("answers a call to %s with exit %d", async (app, exitCode, stderr) => {
    const result = await cli(["echo", app]);
    expect(result).toMatchObject({ exitCode, stderr, stdout: "" });
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
    expect(result.stderr).toBe(
      "instrument test echo: an app slug is required.\n",
    );
  });

  it("lists each capability in the usage from its schema", async () => {
    expect((await cli(["help"])).stdout).toMatchInlineSnapshot(`
      "  instrument test echo <app> ['<data>'] [--count <count>] [--labels <value>]... [--param <key>=<value>]... [--start-time <start_time>] [--verbose]
            Hands its input back.
            For tests.
        instrument test chat-only
            Only the chat has it.
        instrument test cli-only
            Never in a script."
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
    ).toEqual([{ name: "test.echo", positional: ["app"] }]);
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
