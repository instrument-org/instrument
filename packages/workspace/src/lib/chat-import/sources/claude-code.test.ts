import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { claudeCodeSource } from "./claude-code";

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "claude-code-import-test-"));
});

afterEach(async () => {
  await fs.rm(home, { force: true, recursive: true });
});

const SESSION = "11111111-2222-4333-8444-555555555555";

let clock = 0;
/** A minute later than the record before it. */
function at() {
  clock += 1;
  return new Date(Date.UTC(2026, 0, 2, 10, clock)).toISOString();
}

function envelope(extra: Record<string, unknown>) {
  return {
    cwd: path.join(home, "code", "site"),
    isSidechain: false,
    parentUuid: null,
    sessionId: SESSION,
    timestamp: at(),
    userType: "external",
    uuid: crypto.randomUUID(),
    ...extra,
  };
}

/** The person speaking, as Claude Code writes it. */
const said = (content: unknown, extra: Record<string, unknown> = {}) =>
  envelope({ message: { content, role: "user" }, type: "user", ...extra });

/** One block of a reply: Claude Code writes a record per content block. */
const replied = (block: unknown, model = "claude-test-1") =>
  envelope({
    message: {
      content: [block],
      id: "msg_1",
      model,
      role: "assistant",
      type: "message",
    },
    type: "assistant",
  });

const toolResult = (content: string) =>
  envelope({
    message: {
      content: [{ content, tool_use_id: "toolu_1", type: "tool_result" }],
      role: "user",
    },
    type: "user",
  });

async function writeLog(segments: string[], records: unknown[]) {
  const file = path.join(home, ".claude", "projects", ...segments);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    records
      .map((record) =>
        typeof record === "string" ? record : JSON.stringify(record),
      )
      .join("\n"),
  );
}

const PROJECT = "-home-code-site";

/** A session with every kind of noise a real log mixes into the conversation. */
function session(longResult = "ok") {
  clock = 0;
  return [
    { mode: "default", sessionId: SESSION, type: "mode" },
    said(
      "<local-command-caveat>Caveat: generated while running local commands</local-command-caveat>",
      {
        isMeta: true,
      },
    ),
    said("<command-name>/model</command-name>"),
    said("<local-command-stdout>Set model</local-command-stdout>"),
    said([
      { text: "Plan the garden beds", type: "text" },
      {
        source: { data: "AAAA", media_type: "image/png", type: "base64" },
        type: "image",
      },
    ]),
    replied({ thinking: "hmm", type: "thinking" }),
    replied({ text: "Let me look.", type: "text" }),
    replied({ id: "toolu_1", input: {}, name: "Read", type: "tool_use" }),
    toolResult(longResult),
    replied({ id: "toolu_2", input: {}, name: "Read", type: "tool_use" }),
    toolResult("ok"),
    replied({ id: "toolu_3", input: {}, name: "Bash", type: "tool_use" }),
    toolResult("ok"),
    replied({ text: "Three beds fit.", type: "text" }),
    "{not json",
    said("<system-reminder>be brief</system-reminder>Make them raised"),
    replied({ text: "Synthetic", type: "text" }, "<synthetic>"),
    said("Ask a peer", { origin: { from: "socket", kind: "peer" } }),
    envelope({
      attachment: {
        commandMode: "prompt",
        prompt: "And add a path",
        type: "queued_command",
      },
      type: "attachment",
    }),
    replied({ text: "Done.", type: "text" }),
    { aiTitle: "Garden beds", sessionId: SESSION, type: "ai-title" },
  ];
}

describe("claudeCodeSource", () => {
  it("lists a session with its title, folder and message count", async () => {
    await writeLog([PROJECT, `${SESSION}.jsonl`], session());

    expect(await claudeCodeSource({ homeDir: home }).list())
      .toMatchInlineSnapshot(`
        [
          {
            "createdAt": 2026-01-02T10:01:00.000Z,
            "kind": "claude-code",
            "messages": 5,
            "preview": "Plan the garden beds",
            "project": "~/code/site",
            "sourceId": "11111111-2222-4333-8444-555555555555",
            "title": "Garden beds",
            "updatedAt": 2026-01-02T10:18:00.000Z,
          },
        ]
      `);
  });

  it("reads only what the person and the AI said, a reply per turn", async () => {
    await writeLog([PROJECT, `${SESSION}.jsonl`], session());
    const source = claudeCodeSource({ homeDir: home });

    const read = [];
    for await (const transcript of source.read([SESSION, "gone"])) {
      read.push(transcript);
    }

    expect(read.map((transcript) => transcript.messages))
      .toMatchInlineSnapshot(`
        [
          [
            {
              "createdAt": 2026-01-02T10:04:00.000Z,
              "omitted": {
                "attachments": 1,
              },
              "role": "user",
              "text": "Plan the garden beds",
            },
            {
              "createdAt": 2026-01-02T10:06:00.000Z,
              "model": "claude-test-1",
              "omitted": {
                "toolCalls": {
                  "Bash": 1,
                  "Read": 2,
                },
              },
              "role": "assistant",
              "text": "Let me look.

        Three beds fit.",
            },
            {
              "createdAt": 2026-01-02T10:14:00.000Z,
              "role": "user",
              "text": "Make them raised",
            },
            {
              "createdAt": 2026-01-02T10:17:00.000Z,
              "role": "user",
              "text": "And add a path",
            },
            {
              "createdAt": 2026-01-02T10:18:00.000Z,
              "model": "claude-test-1",
              "role": "assistant",
              "text": "Done.",
            },
          ],
        ]
      `);
  });

  it("counts a long tool result the same whether listing or reading", async () => {
    await writeLog([PROJECT, `${SESSION}.jsonl`], session("x".repeat(20_000)));
    const source = claudeCodeSource({ homeDir: home });

    const [listed] = await source.list();
    const read = [];
    for await (const transcript of source.read([SESSION])) {
      read.push(transcript);
    }

    expect(listed?.messages).toBe(5);
    expect(read[0]?.messages).toHaveLength(5);
  });

  it("prefers the person's own title, and falls back to the opening ask", async () => {
    clock = 0;
    await writeLog(
      [PROJECT, `${SESSION}.jsonl`],
      [
        ...session(),
        { customTitle: "My beds", sessionId: SESSION, type: "custom-title" },
      ],
    );
    clock = 0;
    await writeLog(
      [PROJECT, "22222222-2222-4333-8444-555555555555.jsonl"],
      [
        said(
          "Sketch a trellis for climbing beans along the north fence please",
        ),
        replied({ text: "Sure", type: "text" }),
      ],
    );

    const titles = (await claudeCodeSource({ homeDir: home }).list()).map(
      (c) => c.title,
    );

    expect(titles.toSorted()).toEqual([
      "My beds",
      "Sketch a trellis for climbing beans along the north fence please",
    ]);
  });

  it("marks subagent runs and sessions with no reply as incidental", async () => {
    await writeLog([PROJECT, `${SESSION}.jsonl`], session());
    clock = 0;
    await writeLog(
      [PROJECT, SESSION, "subagents", "agent-abc123.jsonl"],
      [
        said("Find the files", { isSidechain: true }),
        { ...replied({ text: "Found", type: "text" }), isSidechain: true },
      ],
    );
    await writeLog(
      [PROJECT, "33333333-2222-4333-8444-555555555555.jsonl"],
      [said("Hello?")],
    );
    await writeLog(
      [PROJECT, "44444444-2222-4333-8444-555555555555.jsonl"],
      ["garbage", "{}"],
    );

    const listed = await claudeCodeSource({ homeDir: home }).list();

    expect(
      listed.map((c) => [c.sourceId, c.incidental ?? false]).toSorted(),
    ).toEqual([
      ["11111111-2222-4333-8444-555555555555", false],
      ["33333333-2222-4333-8444-555555555555", true],
      ["agent-abc123", true],
    ]);
  });

  it("reads a changed log again and keeps an unchanged one", async () => {
    await writeLog([PROJECT, `${SESSION}.jsonl`], session());
    const source = claudeCodeSource({ homeDir: home });
    expect((await source.list())[0]?.title).toBe("Garden beds");

    await writeLog(
      [PROJECT, `${SESSION}.jsonl`],
      [
        ...session(),
        {
          aiTitle: "Garden beds and a path",
          sessionId: SESSION,
          type: "ai-title",
        },
      ],
    );

    expect((await source.list())[0]?.title).toBe("Garden beds and a path");
  });

  it("lists nothing when Claude Code has no projects", async () => {
    expect(await claudeCodeSource({ homeDir: home }).list()).toEqual([]);
  });
});
