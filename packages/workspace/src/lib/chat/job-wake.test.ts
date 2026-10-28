import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { type ChatId } from "../../schemas/chat-id";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { type SessionMessageDataPart } from "../../schemas/session/message-data-part";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import {
  killBackgroundProcess,
  killSessionBackgroundProcesses,
  promoteBackgroundProcess,
  readBackgroundProcess,
  startBackgroundRun,
} from "../background-processes";
import { chatModelURI, setChatModel } from "../chat-settings";
import { jobEventModelNote } from "../job-event-model-text";
import { sessionOfChat } from "../record-folders";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { isWorking } from "./activity";
import { startJobWake } from "./job-wake";
import { hasWakeOnItsWay } from "./wake-queue";

// Whether a session has a turn running is the workspace machine's to say,
// which a test has none of; a case says.
vi.mock(import("./activity"), async (importOriginal) => ({
  ...(await importOriginal()),
  isWorking: vi.fn(() => false),
}));

// The chat's model is looked up before a wake is sent, which a case holds
// open to read the chat in that gap.
vi.mock(import("../chat-settings"), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, chatModelURI: vi.fn(original.chatModelURI) };
});

// The chat's model is looked up to start the turn a wake writes; the turn
// itself is the machine's, which records what it was sent.
vi.mock(import("@instrument-org/ai-gateway"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchModel: () => Promise.resolve({ ok: true, value: {} } as never),
}));

const sent: unknown[] = [];
const workspaceRef = {
  send: (event: unknown) => {
    sent.push(event);
  },
} as unknown as WorkspaceActorRef;

const sessions: StoreId.Session[] = [];

/** Shorter than the app's, so a case waits less for a wake that is coming. */
const DEBOUNCE_MS = 300;

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "job-wake-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  startJobWake(workspaceRef, { debounceMs: DEBOUNCE_MS });
});

afterEach(async () => {
  vi.mocked(isWorking).mockReturnValue(false);
  await Promise.all(
    sessions.splice(0).map((id) => killSessionBackgroundProcesses(id)),
  );
});

/** A chat someone has written in, and its own session. */
async function chat() {
  const chatId = await chatFor(StoreId.newSessionId());
  const written = await setChatModel(
    chatId,
    AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  );
  if (written.isErr()) {
    throw written.error;
  }
  const sessionId = sessionOfChat(chatId);
  if (!sessionId) {
    throw new Error("expected the chat's session");
  }
  sessions.push(sessionId);
  return { chatId, sessionId };
}

/** A command that outlived its call, which the test ends by hand. */
function promote(
  owner: { chatId: ChatId; sessionId: StoreId.Session },
  command: string,
) {
  let finish: (result: { exitCode: number; output: string }) => void = () =>
    undefined;
  let fail: (error: Error) => void = () => undefined;
  const handle = startBackgroundRun({
    callerSignal: new AbortController().signal,
    command,
    run: ({ signal }) =>
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
        signal.addEventListener("abort", () => {
          fail(new Error("aborted"));
        });
      }),
  });
  const promoted = promoteBackgroundProcess({ handle, ...owner });
  if ("error" in promoted) {
    throw new Error(promoted.error);
  }
  return {
    exit: (exitCode: number, output = "") => {
      finish({ exitCode, output });
    },
    id: promoted.info.id,
  };
}

/** The job events of the wakes sent to `sessionId`. */
function wakesOf(sessionId: StoreId.Session) {
  return sent.flatMap((event) => {
    const { type, value } = event as {
      type: string;
      value: {
        message: {
          parts: {
            data?: SessionMessageDataPart.JobEventDataPart;
            type: string;
          }[];
        };
        sessionId: string;
      };
    };
    return type === "addMessage" && value.sessionId === sessionId
      ? value.message.parts.flatMap((part) =>
          part.type === "data-jobEvent" && part.data ? [part.data] : [],
        )
      : [];
  });
}

/** Long enough for a wake that is coming to have been sent. */
async function pastTheDebounce() {
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS * 3));
}

describe("a background process that ends while its session is at rest", () => {
  it("wakes the session that started it with how it ended and where its output is", async () => {
    const owner = await chat();
    const job = promote(owner, "ls ~/Documents");

    job.exit(0, "Notes\nTaxes\n");

    await vi.waitFor(() => {
      expect(wakesOf(owner.sessionId)).toHaveLength(1);
    }, 5000);
    const event = wakesOf(owner.sessionId)[0]?.events[0];
    expect(event).toMatchObject({
      command: "ls ~/Documents",
      exitCode: 0,
      id: job.id,
      logFilePath: `.tool-output/${job.id}.log`,
      status: "exited",
    });
    if (!event) {
      return;
    }
    expect(jobEventModelNote({ events: [{ ...event, durationMs: 95_000 }] }))
      .toMatchInlineSnapshot(`
      "
      <instrument-system-note>
      A command you started has ended in the background:
      - ${job.id} (\`ls ~/Documents\`) finished with exit code 0 after 2 minutes. Read what it wrote with \`fg ${job.id}\`; all of it is in \`.tool-output/${job.id}.log\`.
      Nobody typed anything; this note is why you are awake. If the user was waiting on it, read its output and finish what they asked for. Otherwise tell them in a line what came of it.
      </instrument-system-note>"
    `);

    // The wake told it; the turn it starts ending wakes nothing more.
    publisher.publish("session.done", {
      id: owner.chatId,
      sessionId: owner.sessionId,
    });
    await pastTheDebounce();
    expect(wakesOf(owner.sessionId)).toHaveLength(1);
  });

  it("names several that end together in one wake", async () => {
    const owner = await chat();
    const build = promote(owner, "pnpm build");
    const tests = promote(owner, "pnpm test");

    build.exit(0);
    await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS / 3));
    tests.exit(1);

    await pastTheDebounce();
    expect(wakesOf(owner.sessionId)).toHaveLength(1);
    expect(
      wakesOf(owner.sessionId)[0]?.events.map(({ id, status }) => ({
        id,
        status,
      })),
    ).toEqual([
      { id: build.id, status: "exited" },
      { id: tests.id, status: "failed" },
    ]);
  });
});

describe("a background process that wakes nothing", () => {
  it("is one the agent stopped with its own kill", async () => {
    const owner = await chat();
    const job = promote(owner, "node server.js");

    await killBackgroundProcess({ by: "agent", id: job.id, ...owner });

    await pastTheDebounce();
    expect(wakesOf(owner.sessionId)).toEqual([]);
  });

  it("is one the user stopped", async () => {
    const owner = await chat();
    const job = promote(owner, "node server.js");

    await killBackgroundProcess({ by: "user", id: job.id, ...owner });

    await pastTheDebounce();
    expect(wakesOf(owner.sessionId)).toEqual([]);
  });

  it("is one that ends while a turn runs and is read in it", async () => {
    const owner = await chat();
    vi.mocked(isWorking).mockReturnValue(true);
    const job = promote(owner, "sleep 40");

    job.exit(0);
    await pastTheDebounce();
    expect(wakesOf(owner.sessionId)).toEqual([]);

    await readBackgroundProcess({ id: job.id, waitMs: 0, ...owner });
    vi.mocked(isWorking).mockReturnValue(false);
    publisher.publish("session.done", {
      id: owner.chatId,
      sessionId: owner.sessionId,
    });
    await pastTheDebounce();
    expect(wakesOf(owner.sessionId)).toEqual([]);
  });

  it("is one that ends after the user stopped the turn", async () => {
    const owner = await chat();
    const job = promote(owner, "sleep 40");
    publisher.publish("session.done", {
      id: owner.chatId,
      notice: { by: "person", wakesChat: false },
      sessionId: owner.sessionId,
    });

    job.exit(0);

    await pastTheDebounce();
    expect(wakesOf(owner.sessionId)).toEqual([]);
  });
});

describe("a background process that ends while a turn runs", () => {
  it("wakes nothing until that turn ends, then wakes it once if the turn never read it", async () => {
    const owner = await chat();
    vi.mocked(isWorking).mockReturnValue(true);
    const job = promote(owner, "sleep 40");

    job.exit(0);
    await pastTheDebounce();
    expect(wakesOf(owner.sessionId)).toEqual([]);

    vi.mocked(isWorking).mockReturnValue(false);
    publisher.publish("session.done", {
      id: owner.chatId,
      sessionId: owner.sessionId,
    });
    await vi.waitFor(() => {
      expect(wakesOf(owner.sessionId)).toHaveLength(1);
    }, 5000);
    expect(wakesOf(owner.sessionId)[0]?.events[0]?.id).toBe(job.id);
  });
});

describe("a chat with a command's wake on its way", () => {
  it("reads as at work from the turn's end until the wake is sent", async () => {
    const owner = await chat();
    vi.mocked(isWorking).mockReturnValue(true);
    const job = promote(owner, "pnpm build");
    job.exit(0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    vi.mocked(isWorking).mockReturnValue(false);
    publisher.publish("session.done", {
      id: owner.chatId,
      sessionId: owner.sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hasWakeOnItsWay(owner.chatId)).toBe(true);

    await vi.waitFor(() => {
      expect(wakesOf(owner.sessionId)).toHaveLength(1);
    }, 5000);
    // The send is seen before its delivery ends, which still writes the
    // chat's activity after it; the wake is on its way until that is done.
    await vi.waitFor(() => {
      expect(hasWakeOnItsWay(owner.chatId)).toBe(false);
    });
  });

  // Past the debounce the process is marked told, so the unread news no
  // longer says a wake is coming, while the chat's model is still being
  // looked up and the wake has not started.
  it("reads as at work while the chat's model is looked up for the wake", async () => {
    const owner = await chat();
    const { chatModelURI: lookUp } =
      await vi.importActual<typeof import("../chat-settings")>(
        "../chat-settings",
      );
    let found = () => {};
    const lookedUp = new Promise<void>((resolve) => {
      vi.mocked(chatModelURI).mockImplementationOnce(async (chatId) => {
        resolve();
        await new Promise<void>((resume) => {
          found = resume;
        });
        return lookUp(chatId);
      });
    });
    vi.mocked(isWorking).mockReturnValue(true);
    promote(owner, "pnpm build").exit(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.mocked(isWorking).mockReturnValue(false);
    publisher.publish("session.done", {
      id: owner.chatId,
      sessionId: owner.sessionId,
    });

    await lookedUp;
    expect(hasWakeOnItsWay(owner.chatId)).toBe(true);

    found();
    await vi.waitFor(() => {
      expect(wakesOf(owner.sessionId)).toHaveLength(1);
    }, 5000);
    // The send is seen before its delivery ends, which still writes the
    // chat's activity after it; the wake is on its way until that is done.
    await vi.waitFor(() => {
      expect(hasWakeOnItsWay(owner.chatId)).toBe(false);
    });
  });

  it("is not one when the turn ends on nothing unread, or on the user's Stop", async () => {
    const quiet = await chat();
    publisher.publish("session.done", {
      id: quiet.chatId,
      sessionId: quiet.sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hasWakeOnItsWay(quiet.chatId)).toBe(false);

    const halted = await chat();
    vi.mocked(isWorking).mockReturnValue(true);
    promote(halted, "sleep 40").exit(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    vi.mocked(isWorking).mockReturnValue(false);
    publisher.publish("session.done", {
      id: halted.chatId,
      notice: { by: "person", wakesChat: false },
      sessionId: halted.sessionId,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hasWakeOnItsWay(halted.chatId)).toBe(false);
  });
});
