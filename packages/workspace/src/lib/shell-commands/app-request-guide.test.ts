import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { beforeEach, describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { ChatIdSchema } from "../../schemas/chat-id";
import { chatFor } from "../../test/helpers/chat-record";
import { knowChat } from "../../test/helpers/mock-chat-config";
import { writeMessage } from "../../test/helpers/told-history";
import {
  appGuidesShown,
  type RecordedAppGuide,
  withAppGuideHandOffs,
} from "../apps/guide-hand-off";
import { loadApp, writeAppGuide } from "../apps/store";
import { addChildTask } from "../chat/children";
import { ChatReads } from "../chat-reads";
import { ChatWrites } from "../chat-writes";
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

  /**
   * One `app` command in a shell call of `session`, recorded as the bash
   * tool records the call: with the guides it handed over whole.
   */
  async function app(
    args: string[],
    {
      session = sessionId,
      stdin = EMPTY_BYTES,
      usable,
    }: {
      session?: StoreId.Session;
      stdin?: typeof EMPTY_BYTES;
      usable?: number;
    } = {},
  ) {
    const recorded: RecordedAppGuide[] = [];
    const result = await withAppGuideHandOffs(recorded, () =>
      createAppCommand({ chatId, sessionId: session, usable }).execute(
        args,
        createCommandContext({
          cwd: "/Users/me/chat",
          env: new Map<string, string>(),
          fs: new InMemoryFs(),
          stdin,
        }),
      ),
    );
    const command = `instrument app ${args.join(" ")}`;
    const appGuides = appGuidesShown(recorded, result.stdout);
    const messageId = await writeMessage(chatId, session, "assistant", [
      {
        input: { command, yieldMs: 1000 },
        metadata: {
          createdAt: new Date(),
          endedAt: new Date(),
          id: StoreId.newPartId(),
          messageId: StoreId.newMessageId(),
          sessionId: session,
          startedAt: new Date(),
        },
        output: {
          ...(appGuides.length > 0 ? { appGuides } : {}),
          command,
          commands: ["instrument"],
          durationMs: 1,
          exitCode: result.exitCode,
          omittedBytes: 0,
          output: result.stdout,
        },
        state: "output-available",
        toolCallId: `call-${StoreId.newPartId()}`,
        type: "tool-bash",
      },
    ]);
    return { ...result, messageId };
  }

  /** Whether `request` handed the guide over instead of making the request. */
  async function handsOver(
    slug: string,
    options?: Parameters<typeof app>[1],
  ): Promise<boolean> {
    const result = await app(["request", slug, "GET", "/me"], options);
    return result.stdout.startsWith(`Before the first request to "${slug}"`);
  }

  /** Draws the session's rollover boundary after `after`, as a rollover does. */
  async function rollOver(
    session: StoreId.Session,
    after: StoreId.Message,
    usableTokens?: number,
  ) {
    const row = (
      await ChatReads.session({ chatId, sessionId: session })
    )._unsafeUnwrap();
    (
      await ChatWrites.saveSession(
        {
          ...row,
          rolledOverAfterMessageId: after,
          rolledOverUnderUsableTokens: usableTokens,
        },
        chatId,
      )
    )._unsafeUnwrap();
  }

  async function connectedApiApp(slug: string) {
    const made = await app([
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
    ]);
    expect(made.stderr).toBe("");
    expect(made.exitCode).toBe(0);
    const loaded = (
      await loadApp(getWorkspaceConfig().appsDir, slug)
    )._unsafeUnwrap();
    await getWorkspaceConfig().apps.connections.set(slug, {
      manifestHash: loaded.manifestHash,
      status: "connected",
      updatedAt: 1,
    });
    return loaded;
  }

  it("hands the guide over before the session's first request, and not once a call in its window did", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);

    expect(await handsOver(slug)).toBe(true);
    expect(await handsOver(slug)).toBe(false);
  });

  it("counts `app guide` printing the guide as handing it over", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);

    await app(["guide", slug]);
    expect(await handsOver(slug)).toBe(false);
  });

  it("hands it over again once the chat's own rollover cut the call that showed it", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);
    expect(await handsOver(slug)).toBe(true);
    const later = await app(["list"]);

    await rollOver(sessionId, later.messageId);

    expect(await handsOver(slug)).toBe(true);
  });

  it("hands it over again once the guide was edited", async () => {
    const slug = `guide-${chats}`;
    const { dir } = await connectedApiApp(slug);
    expect(await handsOver(slug)).toBe(true);

    writeAppGuide(dir, "# Guide\n\nEvery path takes a trailing slash.");

    expect(await handsOver(slug)).toBe(true);
    expect(await handsOver(slug)).toBe(false);
  });

  it("hands it over to a task forked after the chat rolled over, whose model never saw it", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);
    expect(await handsOver(slug)).toBe(true);
    const later = await app(["list"]);
    await rollOver(sessionId, later.messageId);

    // What `task new` writes: the task carries the chat's boundary.
    const task = await addChildTask(chatId, {
      createdAt: new Date(),
      forkedAtMessageId: later.messageId,
      id: StoreId.newSessionId(),
      rolledOverAfterMessageId: later.messageId,
      title: "Forked",
      updatedAt: new Date(),
    });

    expect(await handsOver(slug, { session: task.id })).toBe(true);
    expect(await handsOver(slug, { session: task.id })).toBe(false);
  });

  it("counts a hand-off before the rollover as seen by a model whose window lifts the boundary, as the request does", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);
    expect(await handsOver(slug)).toBe(true);
    const later = await app(["list"]);
    await rollOver(sessionId, later.messageId, 1000);

    expect(await handsOver(slug, { usable: 2000 })).toBe(false);
    expect(await handsOver(slug, { usable: 1000 })).toBe(true);
  });

  it("counts writing the guide as having it", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);

    await app(["guide", slug], {
      stdin: encodeUtf8ToBytes(
        "# Guide\n\nGET /me answers who the key belongs to.\n",
      ),
    });

    expect(await handsOver(slug)).toBe(false);
  });
});

describe("appGuidesShown", () => {
  const guide = "# Guide\n\nThe whole guide.";
  const handOff = (printed: string) => ({ app: "a", hash: "h", printed });
  const filler = (lines: number) =>
    Array.from({ length: lines }, (_, i) => `line ${i} ${"x".repeat(60)}`).join(
      "\n",
    );

  it.each([
    ["an output shown whole", `${guide}\n`, true],
    [
      "a guide the cut kept, in the output's head",
      `${guide}\n${filler(3000)}`,
      true,
    ],
    [
      "a guide the cut took, in the output's middle",
      `${filler(3000)}\n${guide}\n${filler(3000)}`,
      false,
    ],
  ])("keeps a hand-off in %s: %s", (_, output, kept) => {
    const printed = `${guide}\n`;
    expect(appGuidesShown([handOff(printed)], output)).toHaveLength(
      kept ? 1 : 0,
    );
  });

  it("keeps one too long to show whole even printed alone", () => {
    const printed = `${filler(3000)}\n`;
    expect(
      appGuidesShown([handOff(printed)], `${filler(10)}\n${printed}`),
    ).toHaveLength(1);
  });

  it("keeps one the model wrote, which its own command holds", () => {
    expect(
      appGuidesShown([{ app: "a", hash: "h" }], filler(9000)),
    ).toHaveLength(1);
  });
});
