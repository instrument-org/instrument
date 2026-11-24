import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { applyServedAppCatalog, resetServedAppCatalog } from "./catalog";
import seed from "./catalog-seed.json";
import { getWorkspaceConfig, setWorkspaceConfig } from "../workspace-config";
import { seedApp } from "../../test/helpers/seed-app";
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
  return (await loadApp(slug))._unsafeUnwrap().manifest;
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

  it("passes by an id whose setup cannot be read", async () => {
    await seedApp("sentry", { name: "Sentry", setup: { type: "mcp" } });

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
    // Google Drive as a directory without Instrument's client serves it: a
    // web app whose vendor has a page for adding an account.
    applyServedAppCatalog({
      ...seed,
      entries: seed.entries.map((entry) =>
        entry.slug === "google-drive"
          ? {
              ...entry,
              interfaces: entry.interfaces.map((surface) =>
                "clientId" in surface
                  ? { ...surface, clientId: undefined }
                  : surface,
              ),
            }
          : entry,
      ),
    });
    onTestFinished(resetServedAppCatalog);
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
