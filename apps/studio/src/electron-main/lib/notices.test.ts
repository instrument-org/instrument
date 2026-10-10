import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { env, prefs, userData } = vi.hoisted(() => ({
  env: { version: "2.0.0-beta.58" },
  prefs: { releaseChannel: undefined as string | undefined },
  userData: { dir: "" },
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => userData.dir,
    getVersion: () => env.version,
    on: vi.fn(),
  },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("@/electron-main/stores/machine/preferences", () => ({
  getMachinePreferences: () => ({ get: () => prefs.releaseChannel }),
}));
vi.mock("@/electron-main/platform-api/headers", () => ({
  getPlatformApiHeaders: () => ({ "x-client-version": env.version }),
}));
vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const notice = (overrides: Record<string, unknown> = {}) => ({
  body: "This is the first notice.",
  id: "2026-10-hello-beta",
  kind: "announcement",
  publishedAt: "2026-10-10T00:00:00.000Z",
  severity: "info",
  title: "Hello from the notices feed",
  ...overrides,
});

const fetchMock = vi.fn<typeof fetch>();

/** A fresh copy of the module, so its once-per-launch toast starts unspent. */
async function load() {
  vi.resetModules();
  return import("./notices");
}

/** The address of the nth request, whatever form fetch was handed it in. */
function requestedUrl(n = 0): URL {
  const input = fetchMock.mock.calls[n]?.[0];
  return new URL(input instanceof Request ? input.url : (input ?? ""));
}

function answer(notices: unknown[], { etag = '"a"', pollAfter = 21600 } = {}) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ notices, pollAfter }), {
      headers: { etag },
      status: 200,
    }),
  );
}

describe("notices", () => {
  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "notices-"));
    env.version = "2.0.0-beta.58";
    prefs.releaseChannel = undefined;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("MAIN_VITE_REPORTS_BASE_URL", "https://reports.example");
    return () => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      fs.rmSync(userData.dir, { force: true, recursive: true });
    };
  });

  it("asks for this build's notices and names its channel from the version", async () => {
    const notices = await load();
    answer([notice()]);

    await notices.fetchNotices();

    const url = requestedUrl();
    expect(Object.fromEntries(url.searchParams)).toEqual({
      arch: process.arch,
      channel: "beta",
      platform: process.platform,
      version: "2.0.0-beta.58",
    });
    expect(notices.listNotices()).toMatchObject([
      { id: "2026-10-hello-beta", seen: false },
    ]);
  });

  it("names the channel set on this Mac over the version's", async () => {
    prefs.releaseChannel = "alpha";
    const notices = await load();
    answer([]);

    await notices.fetchNotices();

    expect(requestedUrl().searchParams.get("channel")).toBe("alpha");
  });

  it("sends the last ETag back and keeps what it has on a 304", async () => {
    const notices = await load();
    answer([notice()], { etag: '"v1"' });
    await notices.fetchNotices();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));

    await notices.fetchNotices();

    const headers = fetchMock.mock.calls[1]?.[1]?.headers;
    expect(headers).toMatchObject({ "if-none-match": '"v1"' });
    expect(notices.listNotices()).toHaveLength(1);
  });

  it("keeps the last answer when the service can't be reached", async () => {
    const notices = await load();
    answer([notice()]);
    await notices.fetchNotices();
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await notices.fetchNotices();

    expect(notices.listNotices()).toHaveLength(1);
  });

  it("skips a notice it can't read and keeps the rest", async () => {
    const notices = await load();
    answer([notice({ kind: "something-newer" }), notice({ id: "readable" })]);

    await notices.fetchNotices();

    expect(notices.listNotices().map((n) => n.id)).toEqual(["readable"]);
  });

  it("leaves out dismissed notices and ones past their end, newest first", async () => {
    const notices = await load();
    answer([
      notice({ id: "older", publishedAt: "2026-10-01T00:00:00.000Z" }),
      notice({ id: "newer", publishedAt: "2026-10-09T00:00:00.000Z" }),
      notice({ endsAt: "2026-10-05T00:00:00.000Z", id: "over" }),
      notice({ id: "dismissed" }),
    ]);
    await notices.fetchNotices();

    notices.dismissNotice("dismissed");

    expect(
      notices
        .listNotices(Date.parse("2026-10-10T00:00:00.000Z"))
        .map((n) => n.id),
    ).toEqual(["newer", "older"]);
  });

  it("marks notices seen once the bell is opened", async () => {
    const notices = await load();
    answer([notice()]);
    await notices.fetchNotices();

    notices.markNoticesSeen(["2026-10-hello-beta"]);

    expect(notices.listNotices()[0]?.seen).toBe(true);
  });

  it("lets an important notice toast once, and only one per launch", async () => {
    let notices = await load();
    answer([
      notice({ id: "quiet" }),
      notice({ id: "loud", severity: "important" }),
      notice({ id: "louder", severity: "critical" }),
    ]);
    await notices.fetchNotices();

    expect(notices.claimNoticeToast("quiet")).toBe(false);
    expect(notices.claimNoticeToast("loud")).toBe(true);
    expect(notices.claimNoticeToast("louder")).toBe(false);

    // The next launch gets one more, and never the one already toasted.
    notices = await load();
    expect(notices.claimNoticeToast("loud")).toBe(false);
    expect(notices.claimNoticeToast("louder")).toBe(true);
  });
  it("lists only the last update this computer launched into", async () => {
    const notices = await load();
    env.version = "2.0.0-beta.60";
    notices.noteUpdate({ from: "2.0.0-beta.58", to: "2.0.0-beta.60" });
    env.version = "2.0.0-beta.61";
    notices.noteUpdate({ from: "2.0.0-beta.60", to: "2.0.0-beta.61" });

    expect(notices.listNotices()).toMatchObject([
      {
        action: { href: "/release-notes", label: "What's new" },
        body: "See what's changed since version 2.0.0-beta.60.",
        kind: "update",
        seen: false,
        title: "Instrument updated to 2.0.0-beta.61",
      },
    ]);

    // Running another build, the update no longer describes this one.
    env.version = "2.0.0-beta.60";
    expect(notices.listNotices()).toEqual([]);
  });

  it("keeps an update dismissed, and never toasts it", async () => {
    const notices = await load();
    notices.noteUpdate({ from: "2.0.0-beta.57", to: "2.0.0-beta.58" });
    const [updated] = notices.listNotices();

    expect(notices.claimNoticeToast(updated?.id ?? "")).toBe(false);
    notices.dismissNotice(updated?.id ?? "");

    expect(notices.listNotices()).toEqual([]);
  });
});
