import {
  createCommandContext,
  EMPTY_BYTES,
  encodeUtf8ToBytes,
  InMemoryFs,
} from "just-bash";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { knowChat } from "../../test/helpers/mock-chat-config";
import { readAppGuide, loadApp } from "../apps/store";
import { getWorkspaceConfig } from "../workspace-config";
import { createAppCommand } from "./app";
import { APP_SETUP_IS_THE_CHATS, APPS_ARE_THE_CHATS } from "./app-command";

// The checks that ask a server or a registry answer "can't tell", so no test
// reaches the network.
vi.mock("../apps/preflight", () => ({
  mcpSignInSupport: vi.fn(() => Promise.resolve("unknown")),
  packageExists: vi.fn(() => Promise.resolve("unknown")),
}));

const chatId = ChatIdSchema.parse("app-setup-in-task");
const CHAT_FOLDER = "/Users/me/chat";

beforeEach(() => {
  knowChat(chatId);
});

async function app(
  role: "chat" | "task",
  args: string[],
  {
    files = {},
    stdin,
  }: { files?: Record<string, string>; stdin?: string } = {},
) {
  const fs = new InMemoryFs();
  for (const [name, text] of Object.entries(files)) {
    await fs.writeFile(`${CHAT_FOLDER}/${name}`, text);
  }
  return createAppCommand({
    chatId,
    role,
    sessionId: StoreId.newSessionId(),
  }).execute(
    args,
    createCommandContext({
      cwd: CHAT_FOLDER,
      env: new Map<string, string>(),
      fs,
      stdin: stdin === undefined ? EMPTY_BYTES : encodeUtf8ToBytes(stdin),
    }),
  );
}

/** An API app the chat set up, not yet connected. */
async function chatSetsUp(slug: string) {
  const made = await app("chat", [
    "new",
    slug,
    "--name",
    `Demo ${slug}`,
    "--api",
    "https://api.example.com",
    "--auth",
    "bearer",
    "--test",
    "/me",
    "--force",
  ]);
  expect(made.stderr).toBe("");
  expect(made.exitCode).toBe(0);
}

// Every chat uses the workspace's apps, so a task, which nobody watches,
// changes none of them: it names what it needs, and the chat does it.
describe("app setup from a task", () => {
  it.each([
    [
      "new",
      ["new", "fresh", "--api", "https://api.example.com", "--test", "/me"],
    ],
    [
      "new --force",
      ["new", "task-force", "--web", "https://example.com", "--force"],
    ],
    ["test", ["test", "task-force"]],
    ["icon", ["icon", "task-force", "icon.svg"]],
    ["disconnect", ["disconnect", "task-force"]],
  ])("refuses %s, saying how to hand it to the chat", async (_word, args) => {
    await chatSetsUp("task-force");
    const before = await loadApp(getWorkspaceConfig().appsDir, "task-force");
    const result = await app("task", args, {
      files: { "icon.svg": '<svg viewBox="0 0 16 16"></svg>' },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(`instrument app: ${APP_SETUP_IS_THE_CHATS}\n`);
    expect(
      (
        await loadApp(getWorkspaceConfig().appsDir, "task-force")
      )._unsafeUnwrap().manifestHash,
    ).toBe(before._unsafeUnwrap().manifestHash);
  });

  it("says what to do in words a task can act on", () => {
    expect(APP_SETUP_IS_THE_CHATS).toMatchInlineSnapshot(
      `"only the chat sets up and changes apps, since every chat uses them. End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on."`,
    );
  });

  it("reads a guide and refuses to write one", async () => {
    await chatSetsUp("task-guide");
    const { dir } = (
      await loadApp(getWorkspaceConfig().appsDir, "task-guide")
    )._unsafeUnwrap();
    const guide = await readAppGuide(dir);

    const read = await app("task", ["guide", "task-guide"]);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toBe(`${(guide ?? "").trimEnd()}\n`);

    const written = await app("task", ["guide", "task-guide"], {
      stdin: "How the service works.",
    });
    expect(written.exitCode).toBe(1);
    expect(written.stderr).toBe(`instrument app: ${APP_SETUP_IS_THE_CHATS}\n`);
    expect(await readAppGuide(dir)).toBe(guide);
  });

  it("reads the account an app names and refuses to name one", async () => {
    await chatSetsUp("task-account");
    const read = await app("task", ["account", "task-account"]);
    expect(read.exitCode).toBe(0);
    expect(read.stdout).toContain("names no account yet");

    const named = await app("task", [
      "account",
      "task-account",
      "me@example.com",
    ]);
    expect(named.exitCode).toBe(1);
    expect(named.stderr).toBe(`instrument app: ${APP_SETUP_IS_THE_CHATS}\n`);
    const cleared = await app("task", ["account", "task-account", "--clear"]);
    expect(cleared.exitCode).toBe(1);
  });

  it("looks a service up without a set-up line it cannot run", async () => {
    const task = await app("task", ["catalog", "linear"]);
    expect(task.exitCode).toBe(0);
    expect(task.stdout).toContain(
      "set up: by the chat, named in your needs fence",
    );
    expect(task.stdout).not.toMatch(/app new|connect_app/);

    const chat = await app("chat", ["catalog", "linear"]);
    expect(chat.stdout).toContain("set up: instrument app new linear");
  });

  it("says a missing or unconnected app is the chat's to set up", async () => {
    const missing = await app("task", ["tools", "nowhere"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain(APPS_ARE_THE_CHATS);

    await chatSetsUp("task-unconnected");
    const unconnected = await app("task", [
      "request",
      "task-unconnected",
      "GET",
      "/me",
    ]);
    expect(unconnected.exitCode).toBe(1);
    expect(unconnected.stderr).toMatchInlineSnapshot(`
      "instrument app: "task-unconnected" is not connected. Setting up and connecting apps is the chat's. End your last message with a needs fence naming the app and what it needs (set up, connected, or changed); the chat does it and sends you on.
      "
    `);
    expect(unconnected.stderr).not.toMatch(/connect_app|app test/);

    const chat = await app("chat", [
      "request",
      "task-unconnected",
      "GET",
      "/me",
    ]);
    expect(chat.stderr).toContain("instrument app test");
  });
});
