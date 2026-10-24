import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../schemas/chat-id";
import { SessionMessage } from "../schemas/session/message";
import { StoreId } from "../schemas/store-id";
import { WorkspaceDirSchema } from "../schemas/paths";
import { initializeTestChat } from "../test/helpers/initialize-test-chat";
import { createMockChatConfigForDir } from "../test/helpers/mock-chat-config";
import { applyContextRollover } from "./apply-context-rollover";
import { ChatReads } from "./chat-reads";
import { ChatWrites } from "./chat-writes";
import { addChildTask } from "./chat/children";
import { newMessage } from "./new-message";
import { sessionOfChat } from "./record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "./workspace-config";
import { shellPath } from "./workspace-fs-layout";
import { readWorkspaceInstructions } from "./workspace-instructions";

let root: string;
let file: string;
let sessionId: StoreId.Session;
const chatId = ChatIdSchema.parse("workspace-instructions-test");
const modelURI = AIGatewayModelURI.Schema.parse(
  "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
);

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agents-")));
  file = path.join(root, "AGENTS.md");
  createMockChatConfigForDir(path.join(root, ".instrument", "chats", chatId), {
    unplaced: true,
  });
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    rootDir: WorkspaceDirSchema.parse(root),
    captureException: vi.fn(),
  });
  await initializeTestChat({ chatId });
  const own = sessionOfChat(chatId);
  if (!own) throw new Error("missing chat session");
  sessionId = own;
});

afterEach(async () => {
  await fs.rm(root, { force: true, recursive: true });
});

async function send(to = sessionId) {
  const message = (
    await newMessage({ chatId, modelURI, prompt: "Hello", sessionId: to })
  )._unsafeUnwrap();
  if (!message || !("role" in message)) throw new Error("expected a message");
  (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();
  return message;
}

function texts(messages: SessionMessage.WithParts[]) {
  return SessionMessage.toUIMessages(messages).map((message) =>
    message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n"),
  );
}

describe("workspace AGENTS.md", () => {
  it("ignores missing, empty, and nested instruction files without creating a root file", async () => {
    await fs.mkdir(path.join(root, "Project"));
    await fs.writeFile(path.join(root, "Project", "AGENTS.md"), "nested rule");
    expect(texts([await send()]).join()).not.toContain(
      "workspace_instructions",
    );
    await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    await fs.writeFile(file, " \n\t");
    expect(await readWorkspaceInstructions()).toEqual({
      file: shellPath(file),
    });
  });

  it("snapshots changes and removal in existing chats and renders unchanged instructions once", async () => {
    const before = await send();
    await fs.writeFile(file, "Use short paragraphs.");
    const first = await send();
    const same = await send();
    await fs.writeFile(file, "Use metric units.");
    const changed = await send();
    await fs.unlink(file);
    const removed = await send();
    const stillRemoved = await send();
    const rendered = texts([
      before,
      first,
      same,
      changed,
      removed,
      stillRemoved,
    ]);
    expect(rendered[0]).not.toContain("workspace instructions");
    expect(rendered[1]).toContain("Use short paragraphs.");
    expect(rendered[2]).not.toContain("Use short paragraphs.");
    expect(rendered[3]).toContain("Use metric units.");
    expect(rendered[4]).toContain(
      "Stop applying the previous workspace instructions.",
    );
    expect(rendered[5]).not.toContain("previous workspace instructions");
    expect(texts([first]).join()).toContain("Use short paragraphs.");
  });

  it.each([
    ["paragraphs", `${"a".repeat(19_990)}\n\n${"ZZZ ".repeat(30)}`, "ZZZ"],
    ["one long line", "a".repeat(100_000), "a".repeat(20_001)],
  ])(
    "bounds %s before persisting the snapshot and names the full file",
    async (_name, content, omitted) => {
      await fs.writeFile(file, content);
      const message = await send();
      const snapshot = message.parts.find(
        (part) => part.type === "data-workspaceInstructions",
      );
      expect(snapshot?.data.instructions?.length).toBeLessThan(
        20_000 + shellPath(file).length + 100,
      );
      expect(snapshot?.data.instructions).not.toContain(omitted);
      expect(snapshot?.data.instructions).toContain(
        `the rest is in ${shellPath(file)}`,
      );
      (await ChatWrites.saveMessageWithParts(message, chatId))._unsafeUnwrap();
      const stored = (
        await ChatReads.modelHistory({ chatId, sessionId })
      )._unsafeUnwrap();
      expect(texts(stored).join()).toContain("Cut off here");
    },
  );

  it("retains the newest snapshot when rollover drops the original instruction message", async () => {
    await fs.writeFile(file, "Use metric units.");
    const first = await send();
    const newest = await send();
    newest.parts.push({
      metadata: {
        createdAt: new Date(),
        id: StoreId.newPartId(),
        messageId: newest.id,
        sessionId,
      },
      text: "x".repeat(40_001),
      type: "text",
    });
    const rolled = applyContextRollover({
      messages: [first, newest],
      rolledOverAfterMessageId: newest.id,
    });
    expect(rolled).toHaveLength(1);
    expect(texts(rolled).join()).toContain("Use metric units.");
  });

  it("inherits the snapshot in a fork and refreshes it on a task's next message", async () => {
    await fs.writeFile(file, "Use metric units.");
    const first = await send();
    (await ChatWrites.saveMessageWithParts(first, chatId))._unsafeUnwrap();
    const taskId = StoreId.newSessionId();
    await addChildTask(chatId, {
      id: taskId,
      title: "Check workspace instructions",
      createdAt: new Date(),
      forkedAtMessageId: first.id,
    });
    const inherited = (
      await ChatReads.modelHistory({ chatId, sessionId: taskId })
    )._unsafeUnwrap();
    expect(texts(inherited).join()).toContain("Use metric units.");
    await fs.writeFile(file, "Use imperial units.");
    const next = await send(taskId);
    expect(texts([...inherited, next]).at(-1)).toContain("Use imperial units.");
    await fs.unlink(file);
    expect(texts([...inherited, next, await send(taskId)]).at(-1)).toContain(
      "Stop applying",
    );
  });

  it("reports a read failure without treating it as removal or blocking the message", async () => {
    await fs.mkdir(file);
    const message = await send();
    expect(
      message.parts.some((part) => part.type === "data-workspaceInstructions"),
    ).toBe(false);
    expect(getWorkspaceConfig().captureException).toHaveBeenCalled();
  });
});
