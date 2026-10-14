import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { computerPlaces } from "./computer-places";

const PLATFORM = process.platform;

beforeEach(() => {
  Object.defineProperty(process, "platform", { value: "win32" });
  vi.useFakeTimers();
  // C: answers, Z: is a mapped drive whose server is gone and never does,
  // and every other letter has nothing behind it.
  vi.spyOn(fs, "stat").mockImplementation(((target: string) => {
    if (target === "C:\\") {
      return Promise.resolve({ isDirectory: () => true });
    }
    if (target === "Z:\\") {
      return new Promise(() => {});
    }
    return Promise.reject(
      Object.assign(new Error("not there"), { code: "ENOENT" }),
    );
    // Stands in for every overload with the one shape the places read.
  }) as unknown as typeof fs.stat);
});

afterEach(() => {
  Object.defineProperty(process, "platform", { value: PLATFORM });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("lists a Windows drive whose root never answers by its letter, without waiting on it", async () => {
  const places = computerPlaces();
  await vi.advanceTimersByTimeAsync(500);
  await expect(places).resolves.toMatchObject({
    volumes: [
      { kind: "drive", name: "C:", path: "C:\\" },
      { kind: "drive", name: "Z:", path: "Z:\\" },
    ],
  });

  // Asked again, the root still being checked is not checked a second time.
  const again = computerPlaces();
  await vi.advanceTimersByTimeAsync(500);
  await expect(again).resolves.toMatchObject({
    volumes: [{ path: "C:\\" }, { path: "Z:\\" }],
  });
  expect(
    vi.mocked(fs.stat).mock.calls.filter(([at]) => at === "Z:\\"),
  ).toHaveLength(1);
});
