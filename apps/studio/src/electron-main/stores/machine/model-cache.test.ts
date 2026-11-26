import { type AIGatewayModel } from "@instrument-org/ai-gateway";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { dir } = vi.hoisted(() => ({ dir: { path: "" } }));

vi.mock("@/electron-main/lib/electron-logger", () => ({
  logger: { error: vi.fn() },
}));
// The store as the app makes it, in a folder of the test's own.
vi.mock("@/electron-main/stores/store", async (original) => {
  const { default: Store } =
    await original<typeof import("@/electron-main/stores/store")>();
  return {
    default: class extends Store<Record<string, unknown>> {
      constructor(options: ConstructorParameters<typeof Store>[0]) {
        super({ ...options, cwd: dir.path });
      }
    },
  };
});

beforeEach(() => {
  dir.path = fs.mkdtempSync(path.join(os.tmpdir(), "model-cache-"));
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 1) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  fs.rmSync(dir.path, { force: true, recursive: true });
});

const DAY_MS = 24 * 60 * 60 * 1000;

const models = (id: string) => [{ id }] as unknown as AIGatewayModel.Type[]; // only the cache's keys matter here

const stored = () =>
  JSON.parse(
    fs.readFileSync(path.join(dir.path, "model-cache.json"), "utf8"),
  ) as { models: Record<string, unknown>; written: Record<string, number> };

it("drops lists not written in 30 days, and lists written before writes were dated", async () => {
  fs.writeFileSync(
    path.join(dir.path, "model-cache.json"),
    JSON.stringify({ models: { undated: [] } }),
  );
  const { diskModelCache } = await import("./model-cache");

  diskModelCache.write("old", models("old"));
  vi.advanceTimersByTime(20 * DAY_MS);
  diskModelCache.write("recent", models("recent"));
  vi.advanceTimersByTime(11 * DAY_MS);
  diskModelCache.write("new", models("new"));

  expect(Object.keys(stored().models).toSorted()).toEqual(["new", "recent"]);
  expect(Object.keys(stored().written).toSorted()).toEqual(["new", "recent"]);
});

it("keeps a list written unchanged all along, restamping it once a day", async () => {
  const { diskModelCache } = await import("./model-cache");

  diskModelCache.write("active", models("active"));
  const first = stored().written.active;
  diskModelCache.write("active", models("active"));
  expect(stored().written.active).toBe(first);

  for (let day = 0; day < 31; day += 1) {
    vi.advanceTimersByTime(DAY_MS);
    diskModelCache.write("active", models("active"));
  }
  diskModelCache.write("other", models("other"));

  expect(Object.keys(stored().models).toSorted()).toEqual(["active", "other"]);
  expect(stored().written.active).toBe(Date.now());
});
