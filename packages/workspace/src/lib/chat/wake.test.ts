import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { type WorkspaceActorRef } from "../../machines/workspace";
import { publisher } from "../../rpc/publisher";
import { AbsolutePathSchema, WorkspaceDirSchema } from "../../schemas/paths";
import { StoreId } from "../../schemas/store-id";
import { chatFor } from "../../test/helpers/chat-record";
import { chatTaskFor } from "../../test/helpers/chat-task";
import { updateChatSettings } from "../chat-settings";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { childTask } from "./children";
import { expectStop, startChatWake } from "./wake";

vi.mock(import("../session-store-storage"));

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

beforeAll(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wake-"));
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    chatsDir: AbsolutePathSchema.parse(path.join(root, "chats")),
    rootDir: WorkspaceDirSchema.parse(root),
  });
  startChatWake(workspaceRef);
});

/** A chat someone has written in, with one task. */
async function chatWithTask() {
  const chatId = chatFor(StoreId.newSessionId());
  const written = await updateChatSettings(chatId, {
    modelURI: AIGatewayModelURI.Schema.parse(
      "zai-org/glm-5.3-flash?provider=openrouter&providerConfigId=mock-provider-config-id",
    ),
  });
  if (written.isErr()) {
    throw written.error;
  }
  const taskSession = await chatTaskFor(chatId, { title: "Audit the vault" });
  return { chatId, taskSession };
}

/** The task events of the wakes sent to `chatId`. */
function wakesOf(chatId: string) {
  return sent.flatMap((event) => {
    const { type, value } = event as {
      type: string;
      value: {
        id: string;
        message: { parts: { data?: { events?: unknown[] }; type: string }[] };
      };
    };
    return type === "addMessage" && value.id === chatId
      ? value.message.parts.flatMap((part) => part.data?.events ?? [])
      : [];
  });
}

describe("a stopped task", () => {
  it("wakes the chat saying the user stopped it, and keeps who did on its row", async () => {
    const { chatId, taskSession } = await chatWithTask();

    expectStop(taskSession, { by: "user", wakesChat: true });
    publisher.publish("session.done", { id: chatId, sessionId: taskSession });

    await vi.waitFor(() => {
      expect(wakesOf(chatId)).toHaveLength(1);
    }, 5000);
    expect(wakesOf(chatId)[0]).toMatchObject({
      sessionId: taskSession,
      stoppedBy: "user",
      title: "Audit the vault",
    });
    expect((await childTask(chatId, taskSession))?.stoppedBy).toBe("user");
  });

  it("wakes nothing when the chat stopped it, and forgets the stop once its next turn ends", async () => {
    const { chatId, taskSession } = await chatWithTask();

    expectStop(taskSession, { by: "chat", wakesChat: false });
    publisher.publish("session.done", { id: chatId, sessionId: taskSession });
    await vi.waitFor(async () => {
      expect((await childTask(chatId, taskSession))?.stoppedBy).toBe("chat");
    });

    publisher.publish("session.done", { id: chatId, sessionId: taskSession });
    await vi.waitFor(() => {
      expect(wakesOf(chatId)).toHaveLength(1);
    }, 5000);
    expect(wakesOf(chatId)[0]).not.toHaveProperty("stoppedBy");
    expect((await childTask(chatId, taskSession))?.stoppedBy).toBeUndefined();
  });
});
