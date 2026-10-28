import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AIGatewayModel,
  AIGatewayModelURI,
} from "@instrument-org/ai-gateway/schemas";
import { AIProviderConfigIdSchema } from "@instrument-org/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { env, prefs, sandbox, userData, workspace } = vi.hoisted(() => ({
  env: { version: "2.0.0-beta.58" },
  workspace: { defaultModelURI: undefined as string | undefined },
  sandbox: { browser: false, off: undefined as string | undefined },
  prefs: {
    releaseChannel: undefined as string | undefined,
    runAnyway: false,
  },
  userData: { dir: "" },
}));

vi.mock("electron", () => ({
  app: {
    getPath: () => userData.dir,
    getVersion: () => env.version,
    on: vi.fn(),
  },
}));
// The real check probes this computer's sandbox, which differs by machine.
vi.mock("@instrument-org/workspace/electron", () => ({
  nativeSandboxOff: () => sandbox.off,
}));
vi.mock("./chromium-sandbox", () => ({
  chromiumSandboxOff: () => sandbox.browser,
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));
vi.mock("@/electron-main/stores/machine/preferences", () => ({
  getMachinePreferences: () => ({
    get: (key: string) =>
      key === "runProgramsWithoutSandbox"
        ? prefs.runAnyway
        : prefs.releaseChannel,
  }),
}));
vi.mock("@/electron-main/stores/workspace/preferences", () => ({
  getDefaultModelURI: () => workspace.defaultModelURI,
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
  // The first import transforms the module, which under a full related run
  // took the first case past its timeout; done here once, each case's own
  // `load` only evaluates it again.
  beforeAll(async () => {
    await load();
  }, 30_000);

  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "notices-"));
    env.version = "2.0.0-beta.58";
    prefs.releaseChannel = undefined;
    workspace.defaultModelURI = undefined;
    prefs.runAnyway = false;
    sandbox.off = undefined;
    sandbox.browser = false;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", "https://api.example");
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

  it("lets an important notice toast once, one per launch, and a critical one always", async () => {
    let notices = await load();
    answer([
      notice({ id: "quiet" }),
      notice({ id: "loud", severity: "important" }),
      notice({ id: "also-loud", severity: "important" }),
      notice({ id: "louder", severity: "critical" }),
    ]);
    await notices.fetchNotices();

    expect(notices.claimNoticeToast("quiet")).toBe(false);
    expect(notices.claimNoticeToast("loud")).toBe(true);
    expect(notices.claimNoticeToast("also-loud")).toBe(false);
    expect(notices.claimNoticeToast("louder")).toBe(true);

    // The next launch gets one more, and never one already toasted.
    notices = await load();
    expect(notices.claimNoticeToast("loud")).toBe(false);
    expect(notices.claimNoticeToast("louder")).toBe(false);
    expect(notices.claimNoticeToast("also-loud")).toBe(true);
  });

  it("says where to get a build whose web pages are sandboxed", async () => {
    const notices = await load();
    sandbox.browser = true;
    const [warning] = notices.listNotices();
    expect(warning).toMatchObject({
      action: { label: "Learn more" },
      kind: "security",
      severity: "important",
      title: "Web pages in the browser aren't sandboxed",
    });
    expect(warning?.body).toContain(".deb package");
  });

  it("toasts a notice the app makes itself", async () => {
    const notices = await load();
    sandbox.off = "no-bubblewrap";
    const [warning] = notices.listNotices();
    expect(notices.claimNoticeToast(warning?.id ?? "")).toBe(true);
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

  it("toasts an update the person asked for, and keeps one that landed on quit in the bell", async () => {
    const notices = await load();
    env.version = "2.0.0-beta.61";
    notices.noteUpdate({ from: "2.0.0-beta.60", to: "2.0.0-beta.61" });
    expect(notices.listNotices()).toMatchObject([{ severity: "info" }]);

    notices.noteUpdate({
      asked: true,
      from: "2.0.0-beta.60",
      to: "2.0.0-beta.61",
    });
    const [updated] = notices.listNotices();
    expect(updated?.severity).toBe("important");
    expect(notices.claimNoticeToast(updated?.id ?? "")).toBe(true);
  });

  it("says an install the person asked for didn't land, until an update does", async () => {
    const notices = await load();
    env.version = "2.0.0-beta.106";
    notices.noteInstallFailed({
      from: "2.0.0-beta.106",
      to: "2.0.0-beta.108",
    });

    expect(notices.listNotices()).toMatchObject([
      {
        body: "You're still on version 2.0.0-beta.106. Use the Update button to try again.",
        kind: "update",
        severity: "important",
        title: "Version 2.0.0-beta.108 didn't install",
      },
    ]);

    env.version = "2.0.0-beta.108";
    notices.noteUpdate({
      asked: true,
      from: "2.0.0-beta.106",
      to: "2.0.0-beta.108",
    });
    expect(notices.listNotices()).toMatchObject([
      { title: "Instrument updated to 2.0.0-beta.108" },
    ]);
  });

  it("warns loudly while the agent's programs have no sandbox, and comes back with the next build", async () => {
    const notices = await load();
    sandbox.off = "user-namespaces-closed";
    const [warning] = notices.listNotices();
    expect(warning).toMatchObject({
      action: { label: "Open Settings", settings: "Permissions" },
      kind: "security",
      severity: "critical",
      title: "The agent can't run programs right now",
    });
    notices.dismissNotice(warning?.id ?? "");
    expect(notices.listNotices()).toEqual([]);

    env.version = "2.0.0-beta.59";
    expect(notices.listNotices()).toHaveLength(1);
  });

  it("warns loudly on Windows when its sandbox can't hold the programs, which still run", async () => {
    const notices = await load();
    sandbox.off = "windows";
    const [warning] = notices.listNotices();
    expect(warning).toMatchObject({
      action: { label: "Open Settings", settings: "Permissions" },
      body: "Instrument can't use Windows' sandbox on this computer, so programs like Python scripts can reach any file you can.",
      kind: "security",
      severity: "critical",
      title: "Programs the agent runs can reach all your files",
    });
    notices.dismissNotice(warning?.id ?? "");
    expect(notices.listNotices()).toEqual([]);

    env.version = "2.0.0-beta.59";
    expect(notices.listNotices()).toHaveLength(1);
  });

  it("quiets the warning once the person chose to run programs anyway", async () => {
    const notices = await load();
    sandbox.off = "no-bubblewrap";
    prefs.runAnyway = true;
    expect(notices.listNotices()).toMatchObject([
      {
        severity: "info",
        title: "Programs the agent runs can reach all your files",
      },
    ]);
  });

  it("describes what it found about the sandbox for a report, one problem per cause", async () => {
    const notices = await load();
    sandbox.off = "no-seatbelt";
    expect(notices.describeCondition("sandbox-off")).toEqual({
      fingerprint: "condition:sandbox-off:no-seatbelt",
      found: expect.arrayContaining([
        "sandboxOff: no-seatbelt",
        "runProgramsWithoutSandbox: false",
      ]),
    });
  });

  it("keeps an update dismissed, and never toasts it", async () => {
    const notices = await load();
    notices.noteUpdate({ from: "2.0.0-beta.57", to: "2.0.0-beta.58" });
    const [updated] = notices.listNotices();

    expect(notices.claimNoticeToast(updated?.id ?? "")).toBe(false);
    notices.dismissNotice(updated?.id ?? "");

    expect(notices.listNotices()).toEqual([]);
  });

  describe("a folder opened with its .instrument taken out", () => {
    it("says the chats weren't there and how to put them back", async () => {
      const notices = await load();
      notices.noteStartedOver("/Users/mac-user/Documents/Instrument");

      expect(notices.listNotices()).toMatchObject([
        {
          body: expect.stringMatching(
            /^Instrument couldn't find your chats in “Instrument”, so it started fresh there\. If you deleted its \.instrument folder by mistake, quit Instrument, put the folder back from the .+, and open Instrument again\.$/,
          ),
          severity: "important",
          title: "Your chats weren't in your folder",
        },
      ]);
    });
  });

  describe("chats the conversion left on their database", () => {
    it("says how many are still to come over, and that they are safe", async () => {
      const notices = await load();
      notices.noteChatsLeftBehind(1);

      expect(notices.listNotices()).toMatchObject([
        {
          body: "Instrument couldn't finish bringing one of your chats over, so it looks empty right now. The conversation is safe where it is, and Instrument tries again the next time it starts.",
          severity: "important",
          title: "One chat is still being brought over",
        },
      ]);

      notices.noteChatsLeftBehind(3);

      expect(notices.listNotices()).toMatchObject([
        {
          body: "Instrument couldn't finish bringing 3 of your chats over, so they look empty right now. Their conversations are safe where they are, and Instrument tries again the next time it starts.",
          title: "Some chats are still being brought over",
        },
      ]);
    });

    it("goes once a launch brings them over", async () => {
      const notices = await load();
      notices.noteChatsLeftBehind(2);
      notices.noteChatsLeftBehind(0);

      expect(notices.listNotices()).toEqual([]);
    });

    // The conversion runs at every launch, so the same chats left behind
    // must not raise the notice the person has already dismissed.
    it("stays dismissed while the same chats are left behind", async () => {
      const notices = await load();
      notices.noteChatsLeftBehind(2);
      notices.dismissNotice(notices.listNotices()[0]?.id ?? "");

      notices.noteChatsLeftBehind(2);

      expect(notices.listNotices()).toEqual([]);
    });

    // A chat that converts while another is left behind is news: the count
    // is what the person reads, so a new count is a notice of its own.
    it("comes back for a different number of them", async () => {
      const notices = await load();
      notices.noteChatsLeftBehind(2);
      notices.dismissNotice(notices.listNotices()[0]?.id ?? "");

      notices.noteChatsLeftBehind(1);

      expect(notices.listNotices()).toMatchObject([
        { title: "One chat is still being brought over" },
      ]);
    });
  });
  describe("accounts signed out without the person asking", () => {
    const claudeOpus = AIGatewayModelURI.fromModel({
      author: "anthropic",
      canonicalId: AIGatewayModel.CanonicalIdSchema.parse("claude-opus-5.5"),
      params: {
        provider: "claude-account",
        providerConfigId: AIProviderConfigIdSchema.parse("claude-account"),
      },
    });

    it("asks loudly when new chats start on the account, and quietly otherwise", async () => {
      const notices = await load();
      notices.noteSignedOut("claude-account", [{ id: "claude-account" }]);
      notices.noteSignedOut("chatgpt-account", [
        { id: "01J0000000000000000000000A", label: "me@example.com" },
      ]);
      workspace.defaultModelURI = claudeOpus;

      expect(
        notices.listNotices().map(({ action, body, severity, title }) => ({
          action,
          body,
          severity,
          title,
        })),
      ).toMatchInlineSnapshot(`
        [
          {
            "action": {
              "label": "Sign in again",
              "setting": "chatgpt-account",
              "settings": "Providers",
            },
            "body": "Sign in to me@example.com again to use its models.",
            "severity": "info",
            "title": "You're signed out of ChatGPT",
          },
          {
            "action": {
              "label": "Sign in again",
              "setting": "claude-account",
              "settings": "Providers",
            },
            "body": "Sign in again to keep using Claude Opus 5.5.",
            "severity": "critical",
            "title": "You're signed out of Claude",
          },
        ]
      `);
    });

    it("toasts the loud one", async () => {
      const notices = await load();
      workspace.defaultModelURI = claudeOpus;
      notices.noteSignedOut("claude-account", [{ id: "claude-account" }]);

      expect(notices.claimNoticeToast(notices.listNotices()[0]?.id ?? "")).toBe(
        true,
      );
    });

    it("goes once the account is signed in again or removed", async () => {
      const notices = await load();
      notices.noteSignedOut("claude-account", [{ id: "claude-account" }]);
      notices.noteSignedOut("claude-account", []);

      expect(notices.listNotices()).toEqual([]);
    });

    // Each launch reads the account again, so the same answer must not
    // raise the notice the person has already dismissed.
    it("stays dismissed while the account stays signed out, and comes back the next time", async () => {
      const notices = await load();
      notices.noteSignedOut("claude-account", [{ id: "claude-account" }]);
      notices.dismissNotice(notices.listNotices()[0]?.id ?? "");

      notices.noteSignedOut("claude-account", [{ id: "claude-account" }]);
      expect(notices.listNotices()).toEqual([]);

      notices.noteSignedOut("claude-account", []);
      notices.noteSignedOut("claude-account", [{ id: "claude-account" }]);
      expect(notices.listNotices()).toHaveLength(1);
    });

    it("leaves the other type's accounts alone", async () => {
      const notices = await load();
      notices.noteSignedOut("claude-account", [{ id: "claude-account" }]);
      notices.noteSignedOut("chatgpt-account", []);

      expect(notices.signedOutAccounts()).toMatchObject([
        { id: "claude-account", type: "claude-account" },
      ]);
    });
  });
});
