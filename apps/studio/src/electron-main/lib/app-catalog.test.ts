import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apply, userData } = vi.hoisted(() => ({
  apply: vi.fn<(document: unknown) => "older" | "unreadable" | "used">(),
  userData: { dir: "" },
}));

vi.mock("electron", () => ({
  app: { getPath: () => userData.dir, on: vi.fn() },
}));
vi.mock("@/electron-main/platform-api/headers", () => ({
  getPlatformApiHeaders: () => ({ "x-client-name": "studio" }),
}));
vi.mock("@/electron-main/stores/workspace/session", () => ({
  getSessionStore: () => ({ onDidChange: vi.fn() }),
}));
vi.mock("@instrument-org/workspace/electron", () => ({
  applyServedAppCatalog: apply,
}));
vi.mock("./electron-logger", () => ({
  createScopedLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

const fetchMock = vi.fn<typeof fetch>();
const served = { entries: [{ slug: "slack" }], revision: "2026-10-10" };

async function load() {
  vi.resetModules();
  return import("./app-catalog");
}

function answer(status: number, etag?: string) {
  fetchMock.mockResolvedValueOnce(
    new Response(status === 304 ? null : JSON.stringify(served), {
      headers: etag ? { etag } : {},
      status,
    }),
  );
}

function sentEtag(n: number): string | null {
  return new Headers(fetchMock.mock.calls[n]?.[1]?.headers).get(
    "if-none-match",
  );
}

describe("app catalog", () => {
  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-catalog-"));
    vi.stubEnv("MAIN_VITE_APP_API_BASE_URL", "https://api.example");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    apply.mockReset();
  });

  it("keeps a copy it used and asks with its ETag after", async () => {
    const { fetchAppCatalog } = await load();
    apply.mockReturnValue("used");
    answer(200, '"r1"');
    await fetchAppCatalog();
    answer(304);
    await fetchAppCatalog();

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example/apps/catalog",
    );
    expect(apply).toHaveBeenCalledWith(served);
    expect(sentEtag(1)).toBe('"r1"');
  });

  it("asks for a refused copy whole next time", async () => {
    const { fetchAppCatalog } = await load();
    apply.mockReturnValue("older");
    answer(200, '"r1"');
    await fetchAppCatalog();
    answer(200, '"r1"');
    await fetchAppCatalog();

    expect(sentEtag(1)).toBeNull();
  });

  it("uses the kept copy at launch before asking", async () => {
    const first = await load();
    apply.mockReturnValue("used");
    answer(200, '"r1"');
    await first.fetchAppCatalog();
    apply.mockClear();

    const { startAppCatalog } = await load();
    fetchMock.mockReturnValueOnce(new Promise(() => {}));
    startAppCatalog();

    expect(apply).toHaveBeenCalledWith(served);
  });
});
