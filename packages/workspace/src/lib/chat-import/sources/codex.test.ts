import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { codexSource } from "./codex";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-import-test-"));
});

afterEach(async () => {
  await fs.rm(home, { force: true, recursive: true });
});

const THREAD = "019a0000-1111-7222-8333-444444444444";

let clock = 0;
function line(type: string, payload: Record<string, unknown>) {
  clock += 1;
  // Codex writes these keys in this order, which listing reads by.
  return {
    timestamp: new Date(Date.UTC(2026, 2, 3, 9, clock)).toISOString(),
    ordinal: clock,
    type,
    payload,
  };
}

const userMessage = (...texts: string[]) =>
  line("response_item", {
    type: "message",
    role: "user",
    content: texts.map((text) => ({ text, type: "input_text" })),
  });

const assistantMessage = (text: string, phase = "final_answer") =>
  line("response_item", {
    type: "message",
    role: "assistant",
    content: [{ text, type: "output_text" }],
    phase,
  });

const toolCall = (name: string) =>
  line("response_item", {
    arguments: "{}",
    call_id: "c1",
    name,
    type: "function_call",
  });

function rollout(id = THREAD, source: unknown = "cli") {
  clock = 0;
  return [
    line("session_meta", {
      cwd: path.join(home, "code", "shed"),
      id,
      instructions: "",
      source,
      timestamp: "2026-03-03T09:00:00.000Z",
    }),
    line("response_item", {
      content: [
        {
          text: "<permissions instructions>sandboxed</permissions instructions>",
          type: "input_text",
        },
      ],
      role: "developer",
      type: "message",
    }),
    userMessage(
      "# AGENTS.md instructions for the shed\n\nBe careful.",
      "<environment_context>\n  <cwd>/shed</cwd>\n</environment_context>",
    ),
    line("turn_context", { cwd: "/shed", model: "gpt-test" }),
    userMessage(
      "# Context from my IDE setup:\n\n## Active file: plan.md\n\n## My request for Codex:\nPrice out a cedar shed",
    ),
    line("response_item", { summary: [], type: "reasoning" }),
    assistantMessage("Checking lumber prices.", "commentary"),
    toolCall("exec_command"),
    line("response_item", {
      call_id: "c1",
      output: "ok",
      type: "function_call_output",
    }),
    toolCall("exec_command"),
    line("event_msg", { info: null, type: "token_count" }),
    assistantMessage("About $900 in cedar."),
    "{broken",
    userMessage("<turn_aborted>The user interrupted.</turn_aborted>"),
    userMessage("What about pine?"),
    line("response_item", {
      content: [
        { text: "<image name=[Image #1] path=/tmp/a.png>", type: "input_text" },
        { image_url: "data:image/png;base64,AAAA", type: "input_image" },
        { text: "</image>", type: "input_text" },
      ],
      role: "user",
      type: "message",
    }),
    assistantMessage("Pine is about $500."),
  ];
}

async function writeRollout(
  name: string,
  records: unknown[],
  { zstd = false } = {},
) {
  const file = path.join(home, ".codex", "sessions", "2026", "03", "03", name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const text = records
    .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
    .join("\n");
  await fs.writeFile(
    file,
    zstd ? zlib.zstdCompressSync(Buffer.from(text)) : text,
  );
}

async function readAll(source: ReturnType<typeof codexSource>, ids: string[]) {
  const read = [];
  for await (const transcript of source.read(ids)) {
    read.push(transcript);
  }
  return read;
}

describe("codexSource", () => {
  it("lists a thread by its opening ask, leaving out what Codex wrote into it", async () => {
    await writeRollout(
      `rollout-2026-03-03T09-00-00-${THREAD}.jsonl`,
      rollout(),
    );

    expect(await codexSource({ homeDir: home }).list()).toMatchInlineSnapshot(`
      [
        {
          "createdAt": 2026-03-03T09:05:00.000Z,
          "kind": "codex",
          "messages": 5,
          "preview": "Price out a cedar shed",
          "project": "~/code/shed",
          "sourceId": "019a0000-1111-7222-8333-444444444444",
          "title": "Price out a cedar shed",
          "updatedAt": 2026-03-03T09:16:00.000Z,
        },
      ]
    `);
  });

  it("reads the person's words and one reply per turn", async () => {
    await writeRollout(
      `rollout-2026-03-03T09-00-00-${THREAD}.jsonl`,
      rollout(),
    );

    const [transcript] = await readAll(codexSource({ homeDir: home }), [
      THREAD,
    ]);

    expect(transcript?.messages).toMatchInlineSnapshot(`
      [
        {
          "createdAt": 2026-03-03T09:05:00.000Z,
          "role": "user",
          "text": "Price out a cedar shed",
        },
        {
          "createdAt": 2026-03-03T09:07:00.000Z,
          "model": "gpt-test",
          "omitted": {
            "toolCalls": {
              "exec_command": 2,
            },
          },
          "role": "assistant",
          "text": "Checking lumber prices.

      About $900 in cedar.",
        },
        {
          "createdAt": 2026-03-03T09:14:00.000Z,
          "role": "user",
          "text": "What about pine?",
        },
        {
          "createdAt": 2026-03-03T09:15:00.000Z,
          "omitted": {
            "attachments": 1,
          },
          "role": "user",
          "text": "",
        },
        {
          "createdAt": 2026-03-03T09:16:00.000Z,
          "model": "gpt-test",
          "role": "assistant",
          "text": "Pine is about $500.",
        },
      ]
    `);
  });

  it("reads a compressed rollout and names threads from the session index", async () => {
    await writeRollout(
      `rollout-2026-03-03T09-00-00-${THREAD}.jsonl.zst`,
      rollout(),
      { zstd: true },
    );
    await fs.writeFile(
      path.join(home, ".codex", "session_index.jsonl"),
      [
        JSON.stringify({
          id: THREAD,
          thread_name: "Shed",
          updated_at: "2026-03-03T09:00:00Z",
        }),
        JSON.stringify({
          id: THREAD,
          thread_name: "Cedar shed",
          updated_at: "2026-03-04T09:00:00Z",
        }),
      ].join("\n"),
    );
    const source = codexSource({ homeDir: home });

    const [listed] = await source.list();
    const [read] = await readAll(source, [THREAD]);

    expect([
      listed?.title,
      listed?.messages,
      read?.title,
      read?.messages.length,
    ]).toEqual(["Cedar shed", 5, "Cedar shed", 5]);
  });

  it("marks subagent threads and threads with no reply as incidental", async () => {
    await writeRollout(
      `rollout-2026-03-03T09-00-00-${THREAD}.jsonl`,
      rollout(),
    );
    const guardian = "019a0000-1111-7222-8333-555555555555";
    await writeRollout(
      `rollout-2026-03-03T09-01-00-${guardian}.jsonl`,
      rollout(guardian, { subagent: { other: "guardian" } }),
    );
    const silent = "019a0000-1111-7222-8333-666666666666";
    clock = 0;
    await writeRollout(`rollout-2026-03-03T09-02-00-${silent}.jsonl`, [
      line("session_meta", { cwd: "/", id: silent, source: "exec" }),
      userMessage("Anyone there?"),
    ]);

    const listed = await codexSource({ homeDir: home }).list();

    expect(
      listed.map((c) => [c.sourceId, c.incidental ?? false]).toSorted(),
    ).toEqual([
      [THREAD, false],
      [guardian, true],
      [silent, true],
    ]);
  });

  it("reads the earliest single-file rollouts", async () => {
    const legacy = "2d0b0000-d5b3-4eb6-bb72-cb95d1a1ff09";
    const file = path.join(
      home,
      ".codex",
      "sessions",
      `rollout-2025-06-09-${legacy}.json`,
    );
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        items: [
          {
            content: [{ text: "List the tools", type: "input_text" }],
            role: "user",
            type: "message",
          },
          { summary: [], type: "reasoning" },
          { action: { command: ["ls"] }, type: "local_shell_call" },
          { output: "saw", type: "local_shell_call_output" },
          {
            content: [{ text: "A saw.", type: "output_text" }],
            role: "assistant",
            type: "message",
          },
        ],
        session: {
          id: legacy,
          instructions: "",
          timestamp: "2025-06-09T12:00:00.000Z",
        },
      }),
    );

    const [transcript] = await readAll(codexSource({ homeDir: home }), [
      legacy,
    ]);

    expect(transcript).toMatchInlineSnapshot(`
      {
        "createdAt": 2025-06-09T12:00:00.000Z,
        "kind": "codex",
        "messages": [
          {
            "createdAt": 2025-06-09T12:00:00.000Z,
            "role": "user",
            "text": "List the tools",
          },
          {
            "createdAt": 2025-06-09T12:00:00.000Z,
            "omitted": {
              "toolCalls": {
                "shell": 1,
              },
            },
            "role": "assistant",
            "text": "A saw.",
          },
        ],
        "preview": "List the tools",
        "sourceId": "2d0b0000-d5b3-4eb6-bb72-cb95d1a1ff09",
        "title": "List the tools",
        "updatedAt": 2025-06-09T12:00:00.000Z,
      }
    `);
  });
});
