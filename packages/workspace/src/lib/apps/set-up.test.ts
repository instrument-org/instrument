import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { createMemoryAppsConfig } from "./memory-config";
import { setUpFromDirectory } from "./set-up";
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

  it("sets a second account up beside the first", async () => {
    await setUpFromDirectory({ slug: "notion" });

    expect(await setUpFromDirectory({ slug: "notion" })).toEqual({
      kind: "set-up",
      slug: "notion-2",
    });
  });

  it("starts a web app's sign-in on the directory's sign-in page", async () => {
    await setUpFromDirectory({ slug: "slack" });

    expect(await manifestOf("slack")).toMatchObject({
      signIn: "https://slack.com/signin",
      type: "web",
      url: "https://app.slack.com",
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
