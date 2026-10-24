import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Synthetic ChatGPT and Claude exports, shaped like the real ones: the
 * fields each service writes (including the ones the parsers ignore), the
 * ones it leaves out, and the trees ChatGPT keeps for edits and
 * regenerations.
 */

export type ExportFileMap = Record<string, string | Uint8Array>;

export async function writeZip(
  zipPath: string,
  files: ExportFileMap,
): Promise<void> {
  const writer = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
  for (const [name, content] of Object.entries(files)) {
    await writer.add(
      name,
      new Uint8ArrayReader(
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content,
      ),
    );
  }
  const blob = await writer.close();
  await fs.writeFile(zipPath, new Uint8Array(await blob.arrayBuffer()));
}

export async function writeFolder(
  folder: string,
  files: ExportFileMap,
): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(folder, name)), { recursive: true });
    await fs.writeFile(path.join(folder, name), content);
  }
}

// ---
// ChatGPT
// ---

/** 2026-03-01T12:00:00Z, in the epoch seconds ChatGPT writes. */
const T0 = 1_772_366_400;

type GptNode = {
  id: string;
  parent?: string;
  message?: Record<string, unknown>;
};

function gptMessage(
  id: string,
  role: string,
  content: Record<string, unknown>,
  {
    at,
    metadata = {},
    recipient = "all",
    name = null,
  }: {
    at: number | null;
    metadata?: Record<string, unknown>;
    recipient?: string;
    name?: string | null;
  },
): Record<string, unknown> {
  return {
    id,
    author: { role, name, metadata: {} },
    create_time: at === null ? null : T0 + at + 0.123_456,
    update_time: null,
    content,
    status: "finished_successfully",
    end_turn: role === "assistant" ? true : null,
    weight: 1,
    metadata,
    recipient,
    channel: null,
  };
}

const textContent = (...parts: unknown[]) => ({
  content_type: "text",
  parts,
});

function mapping(nodes: GptNode[]): Record<string, unknown> {
  return Object.fromEntries(
    nodes.map((node) => [
      node.id,
      {
        id: node.id,
        message: node.message ?? null,
        parent: node.parent ?? null,
        children: nodes
          .filter((child) => child.parent === node.id)
          .map((child) => child.id),
      },
    ]),
  );
}

/**
 * A conversation with everything the parser has to step around: a hidden
 * system message and custom instructions, a regenerated first reply, an
 * edited second question (each leaving a branch behind), model thinking, an
 * image the person sent, an image the reply generated through a tool, and a
 * user message with no `model_slug`.
 */
export function chatGptRemodel(): Record<string, unknown> {
  const nodes: GptNode[] = [
    { id: "root" },
    {
      id: "sys",
      parent: "root",
      message: gptMessage("sys", "system", textContent(""), {
        at: null,
        metadata: { is_visually_hidden_from_conversation: true },
      }),
    },
    {
      id: "ctx",
      parent: "sys",
      message: gptMessage(
        "ctx",
        "user",
        {
          content_type: "user_editable_context",
          user_profile: "I live in Portland.",
          user_instructions: "Be brief.",
        },
        {
          at: 0,
          metadata: {
            is_visually_hidden_from_conversation: true,
            user_context_message_data: { about_user_message: "Portland" },
          },
        },
      ),
    },
    {
      id: "u1",
      parent: "ctx",
      message: gptMessage(
        "u1",
        "user",
        textContent("Help me plan a kitchen remodel."),
        { at: 10, metadata: { request_id: "r1", message_source: null } },
      ),
    },
    {
      id: "a1-old",
      parent: "u1",
      message: gptMessage(
        "a1-old",
        "assistant",
        textContent("First draft I was asked to redo."),
        { at: 20, metadata: { model_slug: "gpt-4o", parent_id: "u1" } },
      ),
    },
    {
      id: "a1-thoughts",
      parent: "u1",
      message: gptMessage(
        "a1-thoughts",
        "assistant",
        {
          content_type: "thoughts",
          thoughts: [{ summary: "Budget", content: "Thinking about cost." }],
          source_analysis_msg_id: "x",
        },
        { at: 25, metadata: { model_slug: "gpt-5-thinking" } },
      ),
    },
    {
      id: "a1-recap",
      parent: "a1-thoughts",
      message: gptMessage(
        "a1-recap",
        "assistant",
        { content_type: "reasoning_recap", content: "Thought for 6s" },
        { at: 26, metadata: { model_slug: "gpt-5-thinking" } },
      ),
    },
    {
      id: "a1",
      parent: "a1-recap",
      message: gptMessage(
        "a1",
        "assistant",
        textContent(
          "Start with a budget. \u{e200}cite\u{e202}turn0search1\u{e201}Then pick a layout.",
        ),
        {
          at: 30,
          metadata: {
            model_slug: "gpt-5-thinking",
            finish_details: { type: "stop" },
          },
        },
      ),
    },
    {
      id: "u2-old",
      parent: "a1",
      message: gptMessage("u2-old", "user", textContent("What about floors?"), {
        at: 40,
      }),
    },
    {
      id: "a2-old",
      parent: "u2-old",
      message: gptMessage(
        "a2-old",
        "assistant",
        textContent("Old floor answer."),
        {
          at: 50,
          metadata: { model_slug: "gpt-5" },
        },
      ),
    },
    {
      id: "u2",
      parent: "a1",
      message: gptMessage(
        "u2",
        "user",
        {
          content_type: "multimodal_text",
          parts: [
            {
              content_type: "image_asset_pointer",
              asset_pointer: "file-service://file-abc",
              size_bytes: 120_000,
              width: 1024,
              height: 768,
            },
            "What about tile floors like this?",
          ],
        },
        { at: 60, metadata: { attachments: [{ id: "file-abc" }] } },
      ),
    },
    {
      id: "a3-call",
      parent: "u2",
      message: gptMessage(
        "a3-call",
        "assistant",
        { content_type: "code", language: "json", text: '{"prompt":"tile"}' },
        {
          at: 70,
          metadata: { model_slug: "gpt-5" },
          recipient: "dalle.text2im",
        },
      ),
    },
    {
      id: "a3-tool",
      parent: "a3-call",
      message: gptMessage(
        "a3-tool",
        "tool",
        {
          content_type: "multimodal_text",
          parts: [
            {
              content_type: "image_asset_pointer",
              asset_pointer: "sediment://file-def",
            },
          ],
        },
        { at: 80, name: "dalle.text2im" },
      ),
    },
    {
      id: "a3",
      parent: "a3-tool",
      message: gptMessage(
        "a3",
        "assistant",
        textContent("Here is a sketch of a herringbone tile floor."),
        { at: 90, metadata: { model_slug: "gpt-5" } },
      ),
    },
  ];
  return {
    title: "Kitchen remodel",
    create_time: T0,
    update_time: T0 + 95,
    mapping: mapping(nodes),
    moderation_results: [],
    current_node: "a3",
    plugin_ids: null,
    conversation_id: "gpt-remodel",
    conversation_template_id: null,
    gizmo_id: null,
    gizmo_type: null,
    is_archived: false,
    is_starred: null,
    safe_urls: [],
    default_model_slug: "gpt-5",
    id: "gpt-remodel",
  };
}

/** A conversation with no title, no `current_node` and undated messages. */
export function chatGptUntitled(id = "gpt-untitled"): Record<string, unknown> {
  const nodes: GptNode[] = [
    { id: "root" },
    {
      id: "u1",
      parent: "root",
      message: gptMessage(
        "u1",
        "user",
        textContent("   What's a good   name for a cat?  "),
        { at: null },
      ),
    },
    {
      id: "a1",
      parent: "u1",
      message: gptMessage("a1", "assistant", textContent("Miso."), {
        at: null,
      }),
    },
  ];
  return {
    title: null,
    create_time: T0 + 1000,
    update_time: T0 + 1001,
    mapping: mapping(nodes),
    id,
  };
}

// ---
// Claude
// ---

export function claudeConversation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uuid: "claude-garden",
    name: "Garden planning",
    summary: "",
    created_at: "2026-04-02T09:00:00.000000Z",
    updated_at: "2026-04-02T09:05:00.000000Z",
    account: { uuid: "acct" },
    chat_messages: [
      {
        uuid: "m1",
        text: "Which vegetables grow well in shade?",
        content: [
          {
            start_timestamp: "2026-04-02T09:00:00.000000Z",
            stop_timestamp: "2026-04-02T09:00:00.000000Z",
            type: "text",
            text: "Which vegetables grow well in shade?",
            citations: [],
          },
        ],
        sender: "human",
        created_at: "2026-04-02T09:00:00.000000Z",
        updated_at: "2026-04-02T09:00:00.000000Z",
        attachments: [
          {
            file_name: "yard.txt",
            file_size: 120,
            file_type: "txt",
            extracted_content: "North-facing yard.",
          },
        ],
        files: [{ file_name: "yard.jpg" }],
      },
      {
        uuid: "m2",
        text: "Leafy greens do.",
        content: [
          { type: "thinking", thinking: "Shade tolerant crops..." },
          {
            type: "tool_use",
            name: "web_search",
            input: { query: "shade vegetables" },
          },
          { type: "tool_result", name: "web_search", content: [] },
          { type: "text", text: "Leafy greens do well: lettuce, kale." },
          { type: "tool_use", name: "web_search", input: {} },
          { type: "text", text: "Herbs like mint too." },
        ],
        sender: "assistant",
        created_at: "2026-04-02T09:00:10.000000Z",
        updated_at: "2026-04-02T09:00:10.000000Z",
        attachments: [],
        files: [],
      },
      {
        uuid: "m3",
        text: "Thanks!",
        content: [],
        sender: "human",
        created_at: "2026-04-02T09:05:00.000000Z",
        attachments: [],
        files: [],
      },
    ],
    ...overrides,
  };
}
