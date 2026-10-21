import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INTERRUPTED_TOOL_CALL_ERROR_TEXT } from "../../constants";
import { publisher } from "../../rpc/publisher";
import { ChatIdSchema } from "../../schemas/chat-id";
import { type SessionMessagePart } from "../../schemas/session/message-part";
import { withTestRecords } from "../../test/helpers/with-test-records";
import { isToolPart } from "../is-tool-part";
import { type RecordChanged } from "../record-changes";
import { getWorkspaceConfig } from "../workspace-config";
import { ChatRecords, chatRecords, installChatRecords } from "./chat-records";
import { logFileName } from "./file-names";
import { foldChat } from "./fold";
import { recordLine } from "./record";
import {
  assistantMessage,
  at,
  CHAT,
  DEVICE_A,
  DEVICE_B,
  header,
  messageId,
  messageRecord,
  partId,
  sessionId,
  textPart,
  toolPart,
  userMessage,
} from "./test-records";
import {
  conversationView,
  liveView,
  listView,
  mergeViews,
  stepsView,
} from "./views";

const records = withTestRecords({ device: DEVICE_A });

const chatSession = sessionId(1);
const taskSession = sessionId(2);
const NOW = at(100);

/** A one-pixel PNG, as a tool returns an image. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The chat as a fold of its folder from scratch reads it. */
async function foldedFromDisk(dir = records.dirOf(CHAT)) {
  const names = (await fs.readdir(dir)).filter((name) =>
    name.endsWith(".jsonl"),
  );
  return foldChat(
    await Promise.all(
      names.map(async (name) => ({
        bytes: await fs.readFile(path.join(dir, name)),
        name,
      })),
    ),
  );
}

/** Each session's whole transcript, the bytes calls returned read back. */
async function transcripts(chat: ChatRecords) {
  const read = await chat.read(CHAT);
  return Promise.all(
    read.chat.sessions.map(async ({ id }) =>
      mergeViews(
        conversationView(read, id, { inherited: false }),
        await stepsView(read, id, { inherited: false }),
      ),
    ),
  );
}

function bashCall(
  n: number,
  state: "input-available" | "output-available",
  more: Parameters<typeof toolPart>[0]["more"] = {},
  session = chatSession,
  message = messageId(2),
) {
  return toolPart({
    createdAt: at(n),
    id: partId(n),
    message,
    more,
    session,
    state,
  });
}

/** A chat with its session started and an assistant reply under way. */
async function replyUnderWay(service = records.service) {
  await service.startSession(CHAT, { createdAt: at(0), id: chatSession });
  await service.appendMessage(
    CHAT,
    userMessage(chatSession, messageId(1), at(1)),
  );
  await service.appendMessage(
    CHAT,
    assistantMessage(chatSession, messageId(2), at(2), {
      finishReason: "unknown",
    }),
  );
}

function changes() {
  const heard: RecordChanged[] = [];
  const unsubscribe = publisher.subscribe("record.changed", (change) => {
    heard.push(change);
  });
  return { heard, unsubscribe };
}

describe("ChatRecords", () => {
  it("reads every write in the tick it is asked for, as a fresh fold of its folder reads it once landed", async () => {
    const service = records.service;
    const release = await service.open(CHAT);
    const writes = [
      service.startSession(CHAT, {
        createdAt: at(0),
        id: chatSession,
        title: "Untitled chat",
      }),
      service.appendMessageWithParts(CHAT, {
        ...userMessage(chatSession, messageId(1), at(1)),
        parts: [
          textPart(chatSession, messageId(1), partId(1), "Total it", at(1)),
        ],
      }),
      service.appendMessage(
        CHAT,
        assistantMessage(chatSession, messageId(2), at(2), {
          finishReason: "unknown",
        }),
      ),
      service.appendPart(CHAT, bashCall(2, "input-available")),
      service.updatePart(
        CHAT,
        { messageId: messageId(2), partId: partId(2), sessionId: chatSession },
        () =>
          bashCall(2, "output-available", {
            endedAt: at(3),
            output: { image: { base64Data: PNG, mimeType: "image/png" } },
          }),
      ),
      service.appendMessage(
        CHAT,
        assistantMessage(chatSession, messageId(2), at(2), {
          finishedAt: at(4),
        }),
      ),
      service.appendMessage(
        CHAT,
        userMessage(chatSession, messageId(3), at(5)),
      ),
      service.retract(CHAT, chatSession, [messageId(3)], "edited"),
      service.rollover(CHAT, chatSession, messageId(2), 1000),
      service.state(CHAT, chatSession, "folders", ["/a"]),
      service.state(CHAT, chatSession, "memory", { state: 1 }),
      service.state(CHAT, chatSession, "memory", null),
      service.setting(CHAT, chatSession, {
        field: "title",
        value: { auto: false, text: "Totals" },
      }),
      service.setting(CHAT, chatSession, { field: "starred", value: true }),
      service.startSession(CHAT, {
        createdAt: at(6),
        forkedAt: messageId(1),
        handle: "t1",
        id: taskSession,
        parent: chatSession,
        title: "Look into it",
      }),
      service.appendMessage(
        CHAT,
        userMessage(taskSession, messageId(4), at(7)),
      ),
      service.stopped(CHAT, taskSession, "chat"),
    ];

    const queued = await service.read(CHAT);
    const queuedTranscripts = await transcripts(service);
    await Promise.all(writes);
    const landed = await service.read(CHAT);

    expect(landed.chat).toEqual(await foldedFromDisk());
    expect(queued.chat.sessions.map(({ id }) => id)).toEqual([
      chatSession,
      taskSession,
    ]);
    expect(listView(queued)).toEqual(listView(landed));
    expect(queuedTranscripts).toEqual(await transcripts(service));
    expect(listView(landed)).toEqual([
      {
        createdAt: at(0),
        id: chatSession,
        rolledOverAfterMessageId: messageId(2),
        rolledOverUnderUsableTokens: 1000,
        starredAt: NOW,
        title: "Totals",
        titleSettledAt: NOW,
        updatedAt: NOW,
      },
      {
        createdAt: at(6),
        forkedAtMessageId: messageId(1),
        handle: "t1",
        id: taskSession,
        parentId: chatSession,
        stoppedBy: "chat",
        title: "Look into it",
        updatedAt: NOW,
      },
    ]);
    expect(landed.chat.sessions[0]?.state).toEqual({ folders: ["/a"] });
    // The image went to a blob, and comes back from it.
    const [chatTranscript] = await transcripts(service);
    const call = chatTranscript?.[1]?.parts[0];
    expect(call && isToolPart(call) && call.output).toEqual({
      image: { base64Data: PNG, mimeType: "image/png" },
    });
    expect(await fs.readdir(path.join(records.dirOf(CHAT), "blobs"))).toEqual([
      expect.stringMatching(/^sha256-[0-9a-f]{64}\.png$/),
    ]);
    release();
  });

  it("hands a guard the output a call landed in the same tick, so a stop leaves it", async () => {
    await replyUnderWay();
    await records.service.appendPart(CHAT, bashCall(3, "input-available"));
    const ids = {
      messageId: messageId(2),
      partId: partId(3),
      sessionId: chatSession,
    };
    const output = bashCall(3, "output-available", {
      endedAt: at(4),
      output: { stdout: "done" },
    });
    let stopSaw: SessionMessagePart.Type | undefined;

    const finished = records.service.updatePart(CHAT, ids, () => output);
    const stopped = records.service.updatePart(CHAT, ids, (current) => {
      stopSaw = current;
      return isToolPart(current) && current.state === "input-available"
        ? toolPart({
            createdAt: at(3),
            id: partId(3),
            message: messageId(2),
            session: chatSession,
            state: "input-available",
          })
        : current;
    });

    expect(stopSaw).toBe(output);
    await expect(finished).resolves.toBe(output);
    await expect(stopped).resolves.toBe(output);
    const [session] = (await foldedFromDisk()).sessions;
    expect(session?.messages[1]?.parts).toEqual([output]);
  });

  it("settles what a process of this device's left in flight on its first open, and nothing of another device's", async () => {
    await replyUnderWay();
    await records.service.appendPart(
      CHAT,
      bashCall(3, "output-available", {
        endedAt: at(3),
        output: { stdout: "first" },
      }),
    );
    await records.service.appendPart(CHAT, bashCall(4, "input-available"));
    // Another device's task, at work on that device.
    await records.service.startSession(CHAT, {
      createdAt: at(5),
      id: taskSession,
      parent: chatSession,
    });
    const other = new ChatRecords({
      app: "0.0.0-test",
      device: DEVICE_B,
      dirOf: records.dirOf,
      fsync: false,
    });
    await other.appendMessage(
      CHAT,
      assistantMessage(taskSession, messageId(5), at(6), {
        finishReason: "unknown",
      }),
    );
    await other.appendPart(
      CHAT,
      bashCall(6, "input-available", {}, taskSession, messageId(5)),
    );
    await other.dispose();
    // The process dies partway through a line.
    const log = path.join(
      records.dirOf(CHAT),
      logFileName(chatSession, DEVICE_A),
    );
    await fs.appendFile(log, '{"t":"part","seq":9,"at":"2026-');

    const next = new ChatRecords({
      app: "0.0.0-test",
      device: DEVICE_A,
      dirOf: records.dirOf,
      fsync: false,
    });
    const read = await next.read(CHAT);
    const [chat, task] = read.chat.sessions;
    const reply = chat?.messages[1];

    expect(reply?.role === "assistant" && reply.metadata).toMatchObject({
      error: { kind: "aborted", reason: "unknown" },
      finishedAt: NOW,
      finishReason: "aborted",
    });
    expect(reply?.parts.map((part) => isToolPart(part) && part.state)).toEqual([
      "output-available",
      "output-error",
    ]);
    expect(
      reply?.parts[1] && isToolPart(reply.parts[1]) && reply.parts[1].errorText,
    ).toBe(INTERRUPTED_TOOL_CALL_ERROR_TEXT);
    expect(task?.messages[0]).toMatchObject({
      metadata: { finishReason: "unknown" },
      parts: [{ state: "input-available" }],
    });

    // Once per process: a call this process started after it is its own.
    await next.appendPart(CHAT, bashCall(7, "input-available"));
    await next.close(CHAT);
    const again = await next.read(CHAT);
    expect(
      again.chat.sessions[0]?.messages[1]?.parts.map(
        (part) => isToolPart(part) && part.state,
      ),
    ).toEqual(["output-available", "output-error", "input-available"]);
    await next.dispose();

    expect(await foldedFromDisk()).toEqual(again.chat);
  });

  it("says what each write changed as it is queued", async () => {
    await replyUnderWay();
    const { heard, unsubscribe } = changes();

    const writes = [
      records.service.appendPart(CHAT, bashCall(3, "input-available")),
      records.service.retract(CHAT, chatSession, [messageId(1)], "edited"),
      records.service.state(CHAT, chatSession, "apps", ["slack"]),
      records.service.setting(CHAT, chatSession, {
        field: "archived",
        value: true,
      }),
    ];
    const queued = [...heard];
    await Promise.all(writes);
    unsubscribe();

    expect(queued).toEqual([
      {
        id: CHAT,
        kind: "messages",
        message: { id: messageId(2), removed: false, sessionId: chatSession },
      },
      {
        id: CHAT,
        kind: "messages",
        message: { id: messageId(1), removed: true, sessionId: chatSession },
      },
      { id: CHAT, kind: "session" },
      { id: CHAT, kind: "session" },
    ]);
    expect(heard).toEqual(queued);
  });

  it("keeps a mark that is already set, so it keeps the moment it was made", async () => {
    await replyUnderWay();
    await records.service.setting(CHAT, chatSession, {
      field: "unread",
      value: "new",
    });
    vi.setSystemTime(at(200));
    await records.service.setting(CHAT, chatSession, {
      field: "unread",
      value: "new",
    });

    expect(listView(await records.service.read(CHAT))[0]?.unreadAt).toEqual(
      NOW,
    );
    await records.service.setting(CHAT, chatSession, {
      field: "unread",
      value: null,
    });
    expect(listView(await records.service.read(CHAT))[0]).not.toHaveProperty(
      "unreadAt",
    );
  });

  it("drops a write that failed from what reads see, and says why", async () => {
    if (process.platform === "win32") {
      return;
    }
    await replyUnderWay();
    const log = path.join(
      records.dirOf(CHAT),
      logFileName(chatSession, DEVICE_A),
    );
    await fs.chmod(log, 0o444);
    try {
      const written = records.service.appendPart(
        CHAT,
        bashCall(3, "input-available"),
      );
      expect(
        (await records.service.read(CHAT)).chat.sessions[0]?.messages[1]?.parts,
      ).toHaveLength(1);

      await expect(written).rejects.toMatchObject({ code: "EACCES" });
      expect(
        (await records.service.read(CHAT)).chat.sessions[0]?.messages[1]?.parts,
      ).toEqual([]);
    } finally {
      await fs.chmod(log, 0o644);
    }
  });

  it("refuses a write to a session the chat does not have", async () => {
    await expect(
      records.service.appendMessage(
        CHAT,
        userMessage(chatSession, messageId(1), at(1)),
      ),
    ).rejects.toThrow(/has no session/);
  });

  it("syncs at the commit points a record implies, and only there", async () => {
    const service = new ChatRecords({
      app: "0.0.0-test",
      device: DEVICE_A,
      dirOf: records.dirOf,
    });
    await service.startSession(CHAT, { createdAt: at(0), id: chatSession });
    const handle: FileHandle = await fs.open(records.dir, "r");
    const sync = vi.spyOn(Object.getPrototypeOf(handle), "sync");
    await handle.close();

    const synced = async (write: Promise<unknown>) => {
      sync.mockClear();
      await write;
      return sync.mock.calls.length;
    };
    await expect(
      synced(
        service.appendMessage(
          CHAT,
          userMessage(chatSession, messageId(1), at(1)),
        ),
      ),
    ).resolves.toBe(1);
    await expect(
      synced(
        service.appendMessage(
          CHAT,
          assistantMessage(chatSession, messageId(2), at(2), {
            finishReason: "unknown",
          }),
        ),
      ),
    ).resolves.toBe(0);
    await expect(
      synced(
        service.appendPart(
          CHAT,
          textPart(chatSession, messageId(2), partId(2), "Looking", at(2)),
        ),
      ),
    ).resolves.toBe(0);
    await expect(
      synced(service.appendPart(CHAT, bashCall(3, "input-available"))),
    ).resolves.toBe(1);
    await expect(
      synced(
        service.appendPart(
          CHAT,
          bashCall(3, "output-available", { endedAt: at(4), output: {} }),
        ),
      ),
    ).resolves.toBe(1);
    await expect(
      synced(
        service.appendMessage(
          CHAT,
          assistantMessage(chatSession, messageId(2), at(2), {
            finishedAt: at(5),
          }),
        ),
      ),
    ).resolves.toBe(1);
    sync.mockRestore();
    await service.dispose();
  });

  it("keeps a pinned chat's fold, and folds one it let go of again from its folder", async () => {
    const service = new ChatRecords({
      app: "0.0.0-test",
      device: DEVICE_A,
      dirOf: records.dirOf,
      fsync: false,
      keepUnpinned: 1,
    });
    const pinned = CHAT;
    const unpinned = ChatIdSchema.parse("records-other");
    const release = await service.open(pinned);
    await service.read(unpinned);
    // Another device's log arrives in both folders.
    for (const chatId of [pinned, unpinned]) {
      await fs.mkdir(records.dirOf(chatId), { recursive: true });
      await fs.writeFile(
        path.join(records.dirOf(chatId), logFileName(taskSession, DEVICE_B)),
        [
          header(0, { device: DEVICE_B, id: taskSession }),
          messageRecord(1, userMessage(taskSession, messageId(1), at(1))),
        ]
          .map(recordLine)
          .join(""),
      );
    }
    // A third chat read pushes the unpinned one out.
    await service.read(ChatIdSchema.parse("records-third"));

    expect((await service.read(pinned)).chat.sessions).toEqual([]);
    expect(
      (await service.read(unpinned)).chat.sessions.map(({ id }) => id),
    ).toEqual([taskSession]);
    release();
    await service.dispose();
  });

  it("holds a running turn in memory, says so at most every 100 ms, and settles its parts as records", async () => {
    await replyUnderWay();
    const live = records.service.live(CHAT, chatSession);
    const { heard, unsubscribe } = changes();
    const streaming = (text: string): SessionMessagePart.TextPart => ({
      metadata: {
        createdAt: at(3),
        id: partId(3),
        messageId: messageId(2),
        sessionId: chatSession,
      },
      state: "streaming",
      text,
      type: "text",
    });

    for (const words of ["L", "Lo", "Loo", "Look", "Looki", "Looking"]) {
      live.setPart(streaming(words));
    }
    expect(heard).toHaveLength(1);
    expect(
      liveView(await records.service.read(CHAT), chatSession)[0]?.parts,
    ).toEqual([streaming("Looking")]);
    await vi.waitFor(() => {
      expect(heard).toHaveLength(2);
    });
    expect(
      await fs.readFile(
        path.join(records.dirOf(CHAT), logFileName(chatSession, DEVICE_A)),
        "utf8",
      ),
    ).not.toContain("Looking");

    const settled = textPart(
      chatSession,
      messageId(2),
      partId(3),
      "Looking",
      at(3),
    );
    const landed = live.settle(settled);
    const read = await records.service.read(CHAT);
    expect(liveView(read, chatSession)).toEqual([]);
    expect(read.chat.sessions[0]?.messages[1]?.parts).toEqual([settled]);
    await landed;
    unsubscribe();
  });

  it("takes an updated part out of the turn's memory, so the record is what reads back", async () => {
    await replyUnderWay();
    const live = records.service.live(CHAT, chatSession);
    const ids = {
      messageId: messageId(2),
      partId: partId(3),
      sessionId: chatSession,
    };
    // A generator tool shows what it has before its own result: the offered
    // snapshot is the turn's memory alone, and the one that settles is a
    // record.
    const offered = bashCall(3, "output-available", {
      endedAt: at(3),
      output: { stdout: "half" },
      preliminary: true,
    });
    live.setPart(offered);

    const settled = await records.service.updatePart(CHAT, ids, (current) => {
      // The updater is handed the turn's own copy, which is the newest.
      expect(current).toEqual(offered);
      return bashCall(3, "output-available", {
        endedAt: at(4),
        output: { stdout: "whole" },
      });
    });

    const read = await records.service.read(CHAT);
    expect(liveView(read, chatSession)).toEqual([]);
    expect(read.chat.sessions[0]?.messages[1]?.parts).toEqual([settled]);
  });

  it("ends one reply of a turn, leaving another reply's parts arriving", async () => {
    await replyUnderWay();
    await records.service.appendMessage(
      CHAT,
      assistantMessage(chatSession, messageId(3), at(3), {
        finishReason: "unknown",
      }),
    );
    const live = records.service.live(CHAT, chatSession);
    const streaming = (
      message: number,
      part: number,
      text: string,
    ): SessionMessagePart.TextPart => ({
      metadata: {
        createdAt: at(part),
        id: partId(part),
        messageId: messageId(message),
        sessionId: chatSession,
      },
      state: "streaming",
      text,
      type: "text",
    });
    live.setPart(streaming(2, 4, "The first attempt"));
    live.setPart(streaming(3, 5, "The retry"));

    await live.clear(messageId(2));

    const read = await records.service.read(CHAT);
    expect(liveView(read, chatSession)[0]?.parts).toEqual([
      streaming(3, 5, "The retry"),
    ]);
    expect(
      read.chat.sessions[0]?.messages.map(({ parts }) =>
        parts.map((part) => (part.type === "text" ? part.state : part.type)),
      ),
    ).toEqual([[], ["done"], []]);
  });

  it("answers once every write already asked for is in the chat's files", async () => {
    await replyUnderWay();
    const asked = records.service.appendMessage(
      CHAT,
      assistantMessage(chatSession, messageId(3), at(3), {
        finishReason: "stop",
      }),
    );

    await records.service.landed(CHAT);

    expect(
      (await foldedFromDisk()).sessions[0]?.messages.map(({ id }) => id),
    ).toEqual([messageId(1), messageId(2), messageId(3)]);
    await asked;
  });

  it("is the process's records, made from the workspace's config when none stands in", () => {
    expect(chatRecords()).toBe(records.service);
    installChatRecords(undefined);
    try {
      expect(chatRecords().device).toBe(getWorkspaceConfig().deviceId);
      expect(chatRecords()).toBe(chatRecords());
    } finally {
      installChatRecords(records.service);
    }
  });
});

describe("paths into the workspace", () => {
  function folderChanges(added: string[]): SessionMessagePart.Type {
    return {
      data: { added: added.map((folder) => ({ path: folder })), removed: [] },
      metadata: {
        createdAt: at(2),
        id: partId(3),
        messageId: messageId(1),
        sessionId: chatSession,
      },
      type: "data-folderChanges",
    };
  }

  function onComputer(device: typeof DEVICE_A, workspaceRoot: string) {
    return new ChatRecords({
      app: "0.0.0-test",
      device,
      dirOf: records.dirOf,
      fsync: false,
      workspaceRoot,
    });
  }

  // Two computers keep one workspace in folders of different names: what one
  // wrote of the workspace is where the other keeps it.
  it("are kept by their place in it, and read as this computer's", async () => {
    const mac = onComputer(DEVICE_A, "/Users/sam/Instrument");
    await mac.startSession(CHAT, { createdAt: at(0), id: chatSession });
    await mac.appendMessage(
      CHAT,
      userMessage(chatSession, messageId(1), at(1)),
    );
    await mac.appendPart(
      CHAT,
      folderChanges(["/Users/sam/Instrument/Chats/Plan", "/Users/sam/Code"]),
    );
    await mac.dispose();

    const log = await fs.readFile(
      path.join(records.dirOf(CHAT), logFileName(chatSession, DEVICE_A)),
      "utf8",
    );
    expect(log).toContain('"workspace:/Chats/Plan"');
    expect(log).toContain('"/Users/sam/Code"');

    const other = onComputer(DEVICE_B, "/home/sam/work");
    const read = await other.read(CHAT);
    await other.dispose();
    const part = read.chat.sessions[0]?.messages[0]?.parts[0];
    expect(part?.type === "data-folderChanges" && part.data.added).toEqual([
      { path: "/home/sam/work/Chats/Plan" },
      { path: "/Users/sam/Code" },
    ]);
  });
});
