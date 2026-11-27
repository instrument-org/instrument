import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { computerDrives, computerPlaces } from "./computer-places";

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

it("lists a Windows drive whose root never answers by its root, without waiting on it", async () => {
  const places = computerPlaces();
  await vi.advanceTimersByTimeAsync(500);
  await expect(places).resolves.toMatchObject({
    volumes: [
      { kind: "drive", name: "C:\\", path: "C:\\" },
      { kind: "drive", name: "Z:\\", path: "Z:\\" },
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

// Only the platform is stood in for, so the paths are still joined the way
// this computer joins its own: a Windows host builds `\Volumes\Backup` and
// matches none of the answers below.
it.skipIf(process.platform === "win32")(
  "lists a Mac disk that has stopped answering where it is mounted, without waiting on it",
  async () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const missing = () =>
      Promise.reject(Object.assign(new Error("not there"), { code: "ENOENT" }));
    vi.spyOn(fs, "readdir").mockImplementation(((at: string) =>
      at === "/Volumes"
        ? Promise.resolve(["Macintosh HD", "Backup"])
        : missing()) as unknown as typeof fs.readdir);
    // The boot volume is a link to `/`. The other disk's file system has
    // stopped answering, so where it really is never comes back.
    vi.spyOn(fs, "realpath").mockImplementation(((at: string) =>
      at === "/Volumes/Macintosh HD"
        ? Promise.resolve("/")
        : new Promise(() => {})) as unknown as typeof fs.realpath);
    vi.spyOn(fs, "stat").mockImplementation(((at: string) =>
      at === "/"
        ? Promise.resolve({ isDirectory: () => true })
        : missing()) as unknown as typeof fs.stat);

    const places = computerPlaces();
    await vi.advanceTimersByTimeAsync(500);
    await expect(places).resolves.toMatchObject({
      volumes: [
        { kind: "drive", name: "Macintosh HD", path: "/" },
        { kind: "drive", name: "Backup", path: "/Volumes/Backup" },
      ],
    });
  },
);

it("lists a Windows drive whose space never comes back without its space", async () => {
  vi.spyOn(fs, "statfs").mockImplementation(((target: string) =>
    target === "C:\\"
      ? Promise.resolve({ bavail: 25, blocks: 100, bsize: 4096 })
      : new Promise(() => {})) as unknown as typeof fs.statfs);
  const drives = computerDrives();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(drives).resolves.toEqual([
    {
      name: "C:\\",
      path: "C:\\",
      space: { free: 25 * 4096, total: 100 * 4096 },
    },
    { name: "Z:\\", path: "Z:\\" },
  ]);
});

it("lists OneDrive only once something is in its folder", async () => {
  vi.stubEnv("OneDrive", "C:\\Users\\windows-user\\OneDrive");
  vi.mocked(fs.stat).mockImplementation(((target: string) =>
    target === "C:\\" || target.endsWith("OneDrive")
      ? Promise.resolve({ isDirectory: () => true })
      : Promise.reject(
          Object.assign(new Error("not there"), { code: "ENOENT" }),
        )) as unknown as typeof fs.stat);
  const inside = vi.spyOn(fs, "readdir");
  const cloud = async () => {
    const places = computerPlaces();
    await vi.advanceTimersByTimeAsync(500);
    return (await places).volumes.filter((place) => place.kind === "cloud");
  };

  inside.mockResolvedValue(["desktop.ini"] as never);
  expect(await cloud()).toEqual([]);

  inside.mockResolvedValue(["desktop.ini", "Documents"] as never);
  expect(await cloud()).toMatchObject([
    { path: "C:\\Users\\windows-user\\OneDrive" },
  ]);
  vi.unstubAllEnvs();
});
