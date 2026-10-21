import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { beforeEach, describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { chatFor } from "../../test/helpers/chat-record";
import { knowChat } from "../../test/helpers/mock-chat-config";
import { writeMessage } from "../../test/helpers/told-history";
import { loadApp } from "../apps/store";
import { getWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";

let chats = 0;

describe("app request and the app's guide", () => {
  let chatId: ReturnType<typeof ChatIdSchema.parse>;
  let sessionId: StoreId.Session;

  beforeEach(async () => {
    chatId = ChatIdSchema.parse(`app-request-guide-${++chats}`);
    sessionId = StoreId.newSessionId();
    knowChat(chatId);
    await chatFor(sessionId, chatId);
  });

  async function app(...args: string[]) {
    return createAppCommand({ chatId, sessionId }).execute(
      args,
      createCommandContext({
        cwd: "/Users/me/chat",
        env: new Map<string, string>(),
        fs: new InMemoryFs(),
        stdin: EMPTY_BYTES,
      }),
    );
  }

  /** A shell call that printed `output`, written as a turn writes one. */
  async function ran(command: string, output: string) {
    await writeMessage(chatId, sessionId, "assistant", [
      {
        input: { command, yieldMs: 1000 },
        metadata: {
          createdAt: new Date(),
          endedAt: new Date(),
          id: StoreId.newPartId(),
          messageId: StoreId.newMessageId(),
          sessionId,
          startedAt: new Date(),
        },
        output: {
          command,
          commands: [command],
          durationMs: 1,
          exitCode: 0,
          omittedBytes: 0,
          output,
        },
        state: "output-available",
        toolCallId: `call-${StoreId.newPartId()}`,
        type: "tool-bash",
      },
    ]);
  }

  async function connectedApiApp(slug: string) {
    const made = await app(
      "new",
      slug,
      "--name",
      `Guide ${chats}`,
      "--api",
      "https://api.unknown.invalid/v1",
      "--test",
      "/me",
      "--auth",
      "none",
    );
    expect(made.stderr).toBe("");
    expect(made.exitCode).toBe(0);
    const { manifestHash } = (
      await loadApp(getWorkspaceConfig().appsDir, slug)
    )._unsafeUnwrap();
    await getWorkspaceConfig().apps.connections.set(slug, {
      manifestHash,
      status: "connected",
      updatedAt: 1,
    });
  }

  it("hands the guide over before the session's first request, and not once its history shows it", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);

    const first = await app("request", slug, "GET", "/me");
    expect(first.stdout).toContain(`Before the first request to "${slug}"`);

    await ran(`instrument app request ${slug} GET /me`, first.stdout);
    const second = await app("request", slug, "GET", "/me");

    expect(second.stdout).not.toContain("Before the first request");
  });

  it("hands it over again once a rollover cut the call that showed it", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);
    const first = await app("request", slug, "GET", "/me");
    await ran(`instrument app request ${slug} GET /me`, first.stdout);

    await writeMessage(chatId, sessionId, "assistant", [
      {
        data: { droppedMessages: 1, retainedUserMessages: 0 },
        type: "data-contextRollover",
      },
    ]);

    expect((await app("request", slug, "GET", "/me")).stdout).toContain(
      "Before the first request",
    );
  });
});
