import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { capturePageThumbnail, readPageThumbnail } from "./page-thumbnails";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "page-thumbnails-"));

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceBrowserDir: () => folder,
}));
vi.mock("@/electron-main/browser-view/log", () => ({
  log: { info: () => undefined },
}));

// A frame per capture, each settled by the test: a picture whose JPEG names
// it, or a failure.
const frames = vi.hoisted(
  () =>
    [] as {
      fail: (error: Error) => void;
      show: (name: string) => void;
    }[],
);
vi.mock("@/electron-main/browser-view/capture-frame", () => ({
  captureFrame: () =>
    new Promise((resolve, reject) => {
      frames.push({
        fail: reject,
        show: (name) => {
          const image = {
            resize: () => image,
            toJPEG: () => Buffer.from(name),
          };
          resolve(image);
        },
      });
    }),
}));
vi.mock("electron", () => ({
  webContents: {
    fromId: () => ({ getType: () => "webview", isDestroyed: () => false }),
  },
}));

const pictureOf = (name: string) =>
  `data:image/jpeg;base64,${Buffer.from(name).toString("base64")}`;

afterAll(() => {
  fs.rmSync(folder, { force: true, recursive: true });
});

describe("capturePageThumbnail", () => {
  it("keeps an older picture that was taken when a newer one fails", async () => {
    const older = capturePageThumbnail({ key: "tab_a", webContentsId: 1 });
    const newer = capturePageThumbnail({ key: "tab_a", webContentsId: 1 });
    const [first, second] = frames.splice(0);
    second?.fail(new Error("No frame within 3000ms"));
    first?.show("older");
    await expect(newer).resolves.toBeNull();
    await expect(older).resolves.toBe(pictureOf("older"));
    await expect(readPageThumbnail("tab_a")).resolves.toBe(pictureOf("older"));
  });

  it("never replaces a newer picture with an older one finishing late", async () => {
    const older = capturePageThumbnail({ key: "tab_b", webContentsId: 1 });
    const newer = capturePageThumbnail({ key: "tab_b", webContentsId: 1 });
    const [first, second] = frames.splice(0);
    second?.show("newer");
    await expect(newer).resolves.toBe(pictureOf("newer"));
    first?.show("older");
    await expect(older).resolves.toBeNull();
    await expect(readPageThumbnail("tab_b")).resolves.toBe(pictureOf("newer"));
  });
});
