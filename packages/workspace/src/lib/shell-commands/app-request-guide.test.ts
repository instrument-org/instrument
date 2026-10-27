import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Session } from "../../schemas/session";
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

// A request's address check resolves the host, so the suite answers DNS.
vi.mock("node:dns/promises", () => ({
  default: {
    lookup: vi.fn(() =>
      Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
    ),
  },
}));

let chats = 0;

afterEach(() => {
  vi.unstubAllGlobals();
});

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
      model,
      stdin = EMPTY_BYTES,
    }: {
      /** The canonical id of the model the call answers to. */
      model?: string;
      session?: StoreId.Session;
      stdin?: typeof EMPTY_BYTES;
    } = {},
  ) {
    const recorded: RecordedAppGuide[] = [];
    const result = await withAppGuideHandOffs(recorded, () =>
      createAppCommand({
        chatId,
        model,
        role: "task",
        sessionId: session,
      }).execute(
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
    // The bash tool's output: stdout, then stderr.
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const appGuides = appGuidesShown(recorded, output);
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
          output,
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
    return result.exitCode === 3;
  }

  /** Draws the session's rollover boundary after `after`, as a rollover does. */
  async function rollOver(
    session: StoreId.Session,
    after: StoreId.Message,
    usableTokens?: number,
    rolloverWindows?: Session.RolloverWindows,
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
          rolloverWindows,
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

  it("sends nothing the first time, printing the guide on stderr and exiting 3", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);
    writeAppGuide(
      (await loadApp(getWorkspaceConfig().appsDir, slug))._unsafeUnwrap().dir,
      "# Guide\n\nGET /me answers who the key belongs to.",
    );

    const result = await app(["request", slug, "GET", "/me"]);

    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(3);
    expect(result.stderr.replace(slug, "<slug>")).toMatchInlineSnapshot(`
      "Not sent (exit 3): before the first request to "<slug>", its guide. Read it, then repeat the request.

      # Guide

      GET /me answers who the key belongs to.
      "
    `);
  });

  it("prints a long body whole on stdout, for jq", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);
    expect(await handsOver(slug)).toBe(true);
    const body = JSON.stringify(
      { slides: Array.from({ length: 5000 }, (_, i) => ({ id: `s${i}` })) },
      null,
      2,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(body, {
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    const result = await app(["request", slug, "POST", "/presentations"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(result.stdout)).toEqual(JSON.parse(body));
    expect(result.stderr).toMatchInlineSnapshot(`
      "POST https://api.unknown.invalid/v1/presentations -> 200 (application/json)
      "
    `);
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

  it("counts a hand-off before the rollover as seen by a model the session lifted the boundary for, as the request does", async () => {
    const slug = `guide-${chats}`;
    await connectedApiApp(slug);
    expect(await handsOver(slug)).toBe(true);
    const later = await app(["list"]);
    await rollOver(sessionId, later.messageId, 1000, {
      roomy: { lifted: true, usableTokens: 2000 },
      small: { lifted: false, usableTokens: 1000 },
    });

    expect(await handsOver(slug, { model: "roomy" })).toBe(false);
    expect(await handsOver(slug, { model: "small" })).toBe(true);
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
    ["an output the guide never reached", filler(10), false],
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
