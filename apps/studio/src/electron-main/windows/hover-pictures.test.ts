import { type WebContents } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hoverPictureUrl } from "@/shared/hover-pictures";

let folder = "";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hover-pictures-"));

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceBrowserDir: () => folder,
}));
vi.mock("@/electron-main/lib/electron-logger", () => ({
  createScopedLogger: () => ({ info: () => undefined }),
}));

// A 2x frame per capture, each settled by the test. Its JPEG names where it
// was cut and how wide it was made.
const frames = vi.hoisted(() => [] as ((name: string) => void)[]);
vi.mock("@/electron-main/browser-view/capture-frame", () => ({
  captureFrame: (_: unknown, { rect }: { rect: { width: number } }) =>
    new Promise((resolve) => {
      frames.push((name) => {
        const size = { width: rect.width * 2 };
        const image = (said: string, width: number): unknown => ({
          crop: (cut: {
            height: number;
            width: number;
            x: number;
            y: number;
          }) =>
            image(
              `${said} ${cut.x},${cut.y} ${cut.width}x${cut.height}`,
              cut.width,
            ),
          getSize: () => ({ width }),
          resize: (to: { width: number }) =>
            image(`${said} at ${to.width}`, to.width),
          toJPEG: () => Buffer.from(said),
        });
        resolve(image(name, size.width));
      });
    }),
}));

const load = async () => {
  vi.resetModules();
  return import("./hover-pictures");
};
// Only what the module asks of a contents before the capture, which is mocked.
const contents = { isDestroyed: () => false } as unknown as WebContents;
const rect = { height: 400, width: 600, x: 300, y: 10 };
const a = { key: "group:a", rect, shows: "one" };
type Pictures = Awaited<ReturnType<typeof load>>;
/** Asks for pictures, has their frame come, and keeps them. */
const taken = async (
  pictures: Pictures,
  asked: Parameters<Pictures["takeHoverPictures"]>[1],
  before?: () => Promise<void>,
) => {
  const taking = pictures.takeHoverPictures(contents, asked);
  await before?.();
  frames.at(-1)?.("frame");
  return pictures.keepHoverPictures((await taking) ?? -1);
};
/** What each picture kept shows, read from the file its address names. */
const shown = (kept: { url?: string }[]) =>
  kept.map(({ url }) =>
    fs
      .readFileSync(
        path.join(folder, "hover-pictures", url?.split("/").at(-1) ?? ""),
      )
      .toString(),
  );
const onDisk = () => fs.readdirSync(path.join(folder, "hover-pictures"));

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(root, "each-"));
  frames.length = 0;
});
afterAll(() => {
  fs.rmSync(root, { force: true, recursive: true });
});

describe("hover pictures", () => {
  it("cuts each part from one frame, in the frame's own pixels", async () => {
    const pictures = await load();
    const kept = await taken(pictures, [
      a,
      {
        key: "tab:b",
        rect: { height: 300, width: 200, x: 700, y: 110 },
        shows: "two",
      },
    ]);
    expect(frames).toHaveLength(1);
    expect(shown(kept)).toEqual([
      "frame 0,0 1200x800 at 640",
      "frame 800,200 400x500 at 400",
    ]);
  });

  it("keeps none of what the window did not ask to keep", async () => {
    const pictures = await load();
    const taking = pictures.takeHoverPictures(contents, [a]);
    frames[0]?.("frame");
    await taking;
    expect(
      await pictures.readHoverPictures([{ key: a.key, shows: "one" }]),
    ).toEqual([]);
  });

  it("comes back after a quit, only of what it shows, its bytes only when they are new", async () => {
    const [kept] = await taken(await load(), [a]);
    const second = await load();
    expect(
      await second.readHoverPictures([{ key: a.key, shows: "one" }]),
    ).toEqual([kept]);
    expect(
      await second.readHoverPictures([
        { have: kept?.at, key: a.key, shows: "one" },
      ]),
    ).toEqual([{ at: kept?.at, key: a.key }]);
    expect(
      await second.readHoverPictures([{ key: a.key, shows: "other" }]),
    ).toEqual([]);
  });

  it("keeps one file per key, a replaced one served a minute longer", async () => {
    const pictures = await load();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      await taken(pictures, [{ ...a, shows: "one" }]);
      await taken(pictures, [{ ...a, shows: "two" }]);
      expect(onDisk()).toHaveLength(2);
      vi.advanceTimersByTime(60_000);
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => {
      expect(onDisk()).toHaveLength(1);
    });
  });

  it.each(["forget", "clear"] as const)(
    "keeps nothing of a picture on its way when asked to %s it",
    async (how) => {
      const pictures = await load();
      const kept = await taken(pictures, [a], () =>
        how === "forget"
          ? pictures.forgetHoverPictures([a.key])
          : pictures.clearHoverPictures(),
      );
      expect(kept).toEqual([]);
      expect(onDisk()).toEqual([]);
      expect(await taken(pictures, [a])).toHaveLength(1);
    },
  );

  it("throws away every picture but those asked to keep", async () => {
    const pictures = await load();
    await taken(pictures, [a, { ...a, key: "group:b" }]);
    await pictures.keepOnlyHoverPictures(["group:b"]);
    expect(
      (
        await pictures.readHoverPictures([
          { key: "group:a", shows: "one" },
          { key: "group:b", shows: "one" },
        ])
      ).map(({ key }) => key),
    ).toEqual(["group:b"]);
  });

  it("serves the bytes of a kept picture by its address's name, and of nothing else", async () => {
    const pictures = await load();
    const [kept] = await taken(pictures, [a]);
    const name = kept?.url?.split("/").at(-1) ?? "";
    expect(kept?.url).toBe(hoverPictureUrl(name));
    expect((await pictures.hoverPictureBytes(name))?.toString()).toBe(
      "frame 0,0 1200x800 at 640",
    );
    fs.writeFileSync(path.join(folder, "secret.jpg"), "secret");
    expect(await pictures.hoverPictureBytes("../secret.jpg")).toBeUndefined();
  });
});
