import { createCommandContext, EMPTY_BYTES, InMemoryFs } from "just-bash";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { StoreId } from "../../schemas/store-id";
import { knowChat } from "../../test/helpers/mock-chat-config";
import { loadApp, readAppGuide, removeApp } from "../apps/store";
import { createAppCommand } from "./app";

// The checks that ask a server or a registry answer "can't tell", so no test
// reaches the network.
vi.mock("../apps/preflight", () => ({
  mcpSignInSupport: vi.fn(() => Promise.resolve("unknown")),
  packageExists: vi.fn(() => Promise.resolve("unknown")),
}));

const chatId = ChatIdSchema.parse("app-off-the-web");

beforeEach(() => {
  knowChat(chatId);
});

async function app(...args: string[]) {
  return run("chat", ...args);
}

async function run(role: "chat" | "task", ...args: string[]) {
  return createAppCommand({
    chatId,
    role,
    sessionId: StoreId.newSessionId(),
  }).execute(
    args,
    createCommandContext({
      cwd: "/Users/me/chat",
      env: new Map<string, string>(),
      fs: new InMemoryFs(),
      stdin: EMPTY_BYTES,
    }),
  );
}

async function appOf(slug: string) {
  return (await loadApp(slug))._unsafeUnwrap();
}

async function guideOf(slug: string) {
  return (await readAppGuide((await appOf(slug)).slug)) ?? "";
}

async function manifestOf(slug: string) {
  return (await appOf(slug)).manifest;
}

// A directory that gains a direct sign-in leaves the apps set up before it on
// the web, so its entry says how to move each one, in a line that runs.
describe("app catalog for a service already set up on the web", () => {
  const SLUGS = ["gmail", "gmail-personal", "linear", "zoom"];

  afterEach(async () => {
    for (const slug of SLUGS) {
      const loaded = await loadApp(slug);
      if (loaded.isOk()) {
        await removeApp(loaded.value.slug);
      }
    }
  });

  const moveLine = async (service: string, slug: string) => {
    const { stdout } = await app("catalog", service);
    return new RegExp(`already here: ${slug}\\b.*?\`instrument (.*?)\``).exec(
      stdout,
    )?.[1];
  };

  it.each([
    ["gmail", "gmail", "https://mail.google.com", "api"],
    ["gmail", "gmail-personal", "https://mail.google.com/mail/u/1/", "api"],
    ["linear", "linear", "https://linear.app", "mcp"],
  ])(
    "gives %s's line that moves %s to the direct sign-in",
    async (service, slug, url, type) => {
      await app("new", slug, "--name", "Mine", "--web", url);
      const webGuide = await guideOf(slug);

      const line = await moveLine(service, slug);
      const moved = await app(...(line ?? "").split(" ").slice(1));

      expect(moved.stderr).toBe("");
      expect(moved.stdout).toContain(
        "Ask the user to sign in with connect_app",
      );
      expect(await manifestOf(slug)).toMatchObject({
        auth: { kind: "oauth" },
        service,
        type,
      });
      expect((await appOf(slug)).name).toBe("Mine");
      expect(await guideOf(slug)).not.toBe(webGuide);
      expect(await moveLine(service, slug)).toBeUndefined();
    },
  );

  it("names the account the web app is signed in as", async () => {
    await app(
      "new",
      "gmail",
      "--name",
      "Mine",
      "--web",
      "https://mail.google.com",
    );
    await app("account", "gmail", "work@example.com");

    expect((await app("catalog", "gmail")).stdout).toContain(
      "already here: gmail (work@example.com), set up on the web.",
    );
  });

  it("says nothing where the directory's own way in is the web", async () => {
    await app("new", "zoom", "--name", "Zoom", "--web", "https://zoom.us");

    expect((await app("catalog", "zoom")).stdout).not.toContain("already here");
  });

  it("gives a task no line to move one, since setup is the chat's", async () => {
    await app(
      "new",
      "gmail",
      "--name",
      "Mine",
      "--web",
      "https://mail.google.com",
    );

    expect((await run("task", "catalog", "gmail")).stdout).not.toContain(
      "already here",
    );
  });
});
