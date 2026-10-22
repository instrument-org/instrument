import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatIdSchema } from "../../schemas/chat-id";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { APP_FILE_NAME } from "./app-file";
import { createMemoryAppsConfig } from "./memory-config";
import { recordConnection } from "./connection";
import { moveAppToWeb, setUpFromDirectory } from "./set-up";
import { loadApp } from "./store";
import { runAppTest } from "./test-app";

// An open server is tested on the spot; here the test stands in for it.
vi.mock("./test-app", () => ({
  runAppTest: vi.fn(() => Promise.resolve({ checks: [], passed: true })),
}));

const apps = getWorkspaceConfig().apps;

beforeEach(() => {
  setWorkspaceConfig({
    ...getWorkspaceConfig(),
    apps: createMemoryAppsConfig(),
  });
});

afterEach(() => {
  setWorkspaceConfig({ ...getWorkspaceConfig(), apps });
});

async function manifestOf(slug: string) {
  return (await loadApp(getWorkspaceConfig().appsDir, slug))._unsafeUnwrap()
    .manifest;
}

describe("setUpFromDirectory", () => {
  it("writes a sign-in app and leaves it waiting on the sign-in", async () => {
    expect(await setUpFromDirectory({ slug: "linear" })).toEqual({
      kind: "set-up",
      slug: "linear",
    });
    expect(await manifestOf("linear")).toMatchObject({
      auth: { kind: "oauth" },
      type: "mcp",
      url: "https://mcp.linear.app/mcp",
    });
    expect(
      (await getWorkspaceConfig().apps.connections.get("linear"))?.status,
    ).toBe("needs-sign-in");
  });

  it("passes by an id whose file cannot be read", async () => {
    const dir = path.join(getWorkspaceConfig().appsDir, "Sentry");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, APP_FILE_NAME),
      "---\nid: sentry\ntype: mcp\n---\n",
    );

    expect(await setUpFromDirectory({ slug: "sentry" })).toEqual({
      kind: "set-up",
      slug: "sentry-2",
    });
  });

  it("sets a second account up beside the first", async () => {
    await setUpFromDirectory({ slug: "notion" });

    expect(await setUpFromDirectory({ slug: "notion" })).toEqual({
      kind: "set-up",
      slug: "notion-2",
    });
  });

  it("starts another account's sign-in on the vendor's page for adding one", async () => {
    await setUpFromDirectory({ slug: "google-drive" });
    await setUpFromDirectory({ slug: "google-drive" });

    expect(await manifestOf("google-drive")).toMatchObject({
      service: "google-drive",
      signIn: expect.stringContaining("/ServiceLogin?"),
    });
    expect(await manifestOf("google-drive-2")).toMatchObject({
      service: "google-drive",
      signIn: expect.stringContaining("/AddSession?"),
    });
  });

  it("starts a web app's sign-in on the directory's sign-in page", async () => {
    await setUpFromDirectory({ slug: "pagerduty" });

    expect(await manifestOf("pagerduty")).toMatchObject({
      signIn: "https://app.pagerduty.com/",
      type: "web",
      url: "https://www.pagerduty.com",
    });
  });

  it("connects a server that wants nothing by testing it", async () => {
    await setUpFromDirectory({ slug: "drawio" });

    expect(vi.mocked(runAppTest)).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "drawio" }),
    );
  });

  it.each([
    // A Mac app a task drives has no folder to write.
    "apple-notes",
    "no-such-service",
  ])("hands %s to the agent", async (slug) => {
    expect(await setUpFromDirectory({ slug })).toEqual({ kind: "agent" });
  });
});

describe("moveAppToWeb", () => {
  it("moves an app whose sign-in was refused to the service's site, still waited on", async () => {
    await setUpFromDirectory({ slug: "ahrefs" });
    await recordConnection("ahrefs", {
      ended: "refused",
      error: "access_denied: AADSTS65001",
      status: "failed",
      waitingChats: [ChatIdSchema.parse("asked-for-ahrefs")],
    });

    expect(await moveAppToWeb("ahrefs")).toEqual({
      name: "Ahrefs",
      signIn: "https://app.ahrefs.com",
    });
    expect(await manifestOf("ahrefs")).toMatchInlineSnapshot(`
      {
        "service": "ahrefs",
        "type": "web",
        "url": "https://app.ahrefs.com",
      }
    `);
    const connection =
      await getWorkspaceConfig().apps.connections.get("ahrefs");
    expect({
      ended: connection?.ended,
      error: connection?.error,
      status: connection?.status,
      waitingChats: connection?.waitingChats,
    }).toMatchInlineSnapshot(`
      {
        "ended": undefined,
        "error": undefined,
        "status": "needs-sign-in",
        "waitingChats": [
          "asked-for-ahrefs",
        ],
      }
    `);
    // Pressed again, it opens the same page and writes nothing.
    expect((await moveAppToWeb("ahrefs")).signIn).toBe(
      "https://app.ahrefs.com",
    );
  });
});
