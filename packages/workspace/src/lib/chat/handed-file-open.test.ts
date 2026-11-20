import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessage } from "../../schemas/session/message";
import { StoreId } from "../../schemas/store-id";
import {
  handedFilesOf,
  openHandedFile,
  opensBesideChat,
} from "./handed-file-open";

const asks = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock(import("./window-tab"), () => ({
  askWindow: (ask: unknown) => {
    asks.calls.push(ask);
    return Promise.resolve(undefined);
  },
}));
const roles = vi.hoisted(() => ({ role: "chat" as "chat" | "task" }));
vi.mock(import("./children"), () => ({
  sessionRole: () => roles.role,
}));

const chatId = ChatIdSchema.parse("quarterly-numbers");

function message(
  role: "assistant" | "user",
  text: string,
  sessionId: StoreId.Session,
): SessionMessage.WithParts {
  const id = StoreId.newMessageId();
  const createdAt = new Date();
  const metadata = {
    createdAt,
    id: StoreId.newPartId(),
    messageId: id,
    sessionId,
  };
  return {
    id,
    metadata:
      role === "user"
        ? { createdAt, sessionId }
        : {
            createdAt,
            finishReason: "stop",
            modelId: "m",
            providerId: "openai",
            sessionId,
          },
    parts: [{ metadata, state: "done", text, type: "text" }],
    role,
  } as SessionMessage.WithParts;
}

const fence = (...paths: string[]) =>
  `Here it is.\n\n\`\`\`files\n${paths.join("\n")}\n\`\`\``;

/** A finished turn whose reply hands over these paths. */
function turn(sessionId: StoreId.Session, ...paths: string[]) {
  return [
    message("user", "Make it", sessionId),
    message("assistant", fence(...paths), sessionId),
  ];
}

beforeEach(() => {
  asks.calls = [];
  roles.role = "chat";
});

describe("opensBesideChat", () => {
  it.each([
    ["site/index.html", true],
    ["site/page.HTM", true],
    ["numbers.xlsx", true],
    ["numbers.csv", true],
    ["report.pdf", true],
    ["letter.docx", true],
    ["deck.pptx", true],
    ["chart.png", false],
    ["clip.mp4", false],
    ["voice.m4a", false],
    ["notes.md", false],
    ["notes.txt", false],
    ["convert.py", false],
    ["site/", false],
    ["Budget.numbers", false],
    ["old.doc", false],
  ])("%s: %s", (path, opens) => {
    expect(opensBesideChat(path)).toBe(opens);
  });
});

describe("handedFilesOf", () => {
  it("reads only the latest turn", () => {
    const sessionId = StoreId.newSessionId();
    const handed = handedFilesOf([
      ...turn(sessionId, "old.html"),
      ...turn(sessionId, "new.pdf", "chart.png"),
    ]);
    expect(handed?.paths).toEqual(["new.pdf", "chart.png"]);
  });
});

describe("openHandedFile", () => {
  const open = (
    sessionId: StoreId.Session,
    messages: SessionMessage.WithParts[],
    extra: { notice?: unknown } = {},
  ) =>
    openHandedFile({
      chatId,
      isFile: () => Promise.resolve(true),
      readMessages: () => Promise.resolve(messages),
      sessionId,
      ...extra,
    });

  it("asks the window for the first file that opens, and only that one", async () => {
    const sessionId = StoreId.newSessionId();
    await expect(
      open(sessionId, turn(sessionId, "chart.png", "a.html", "b.xlsx")),
    ).resolves.toBe("a.html");
    expect(asks.calls).toEqual([
      {
        action: { kind: "handOver", path: "a.html" },
        askedBy: chatId,
        group: chatId,
      },
    ]);
  });

  it("opens nothing on a second delivery of the same finished turn", async () => {
    const sessionId = StoreId.newSessionId();
    const messages = turn(sessionId, "report.pdf");
    await open(sessionId, messages);
    await expect(open(sessionId, messages)).resolves.toBeUndefined();
    expect(asks.calls).toHaveLength(1);
  });

  it.each([
    ["pictures, notes and folders alone", ["chart.png", "notes.md", "site/"]],
    ["no files fence", []],
  ])("opens nothing for %s", async (_, paths) => {
    const sessionId = StoreId.newSessionId();
    const messages = paths.length
      ? turn(sessionId, ...paths)
      : [
          message("user", "Hi", sessionId),
          message("assistant", "Hello.", sessionId),
        ];
    await expect(open(sessionId, messages)).resolves.toBeUndefined();
    expect(asks.calls).toEqual([]);
  });

  it("opens nothing for a task's turn, which is drawn inside its chat", async () => {
    roles.role = "task";
    const sessionId = StoreId.newSessionId();
    await expect(
      open(sessionId, turn(sessionId, "report.pdf")),
    ).resolves.toBeUndefined();
    expect(asks.calls).toEqual([]);
  });

  it("opens nothing for a turn a stop ended", async () => {
    const sessionId = StoreId.newSessionId();
    await expect(
      open(sessionId, turn(sessionId, "report.pdf"), {
        notice: { by: "person" },
      }),
    ).resolves.toBeUndefined();
    expect(asks.calls).toEqual([]);
  });

  it("skips a listed file that is not there for the next one that is", async () => {
    const sessionId = StoreId.newSessionId();
    await expect(
      openHandedFile({
        chatId,
        isFile: (_, path) => Promise.resolve(path !== "gone.html"),
        readMessages: () =>
          Promise.resolve(turn(sessionId, "gone.html", "kept.pdf")),
        sessionId,
      }),
    ).resolves.toBe("kept.pdf");
  });
});
