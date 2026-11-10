import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  capturePageThumbnail,
  forgetPageThumbnails,
  readPageThumbnail,
} from "./page-thumbnails";

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
// The address the guest is at, moved by the test.
const guest = vi.hoisted(() => ({ url: "https://one.example/" }));
vi.mock("electron", () => ({
  webContents: {
    fromId: () => ({
      getType: () => "webview",
      getURL: () => guest.url,
      isDestroyed: () => false,
    }),
  },
}));

const pictureOf = (name: string) =>
  `data:image/jpeg;base64,${Buffer.from(name).toString("base64")}`;

/** A picture taken of the page at the guest's first address. */
const taken = (name: string) => ({
  page: "https://one.example/",
  url: pictureOf(name),
});

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
    await expect(older).resolves.toEqual(taken("older"));
    await expect(readPageThumbnail("tab_a")).resolves.toEqual(taken("older"));
  });

  it("never replaces a newer picture with an older one finishing late", async () => {
    const older = capturePageThumbnail({ key: "tab_b", webContentsId: 1 });
    const newer = capturePageThumbnail({ key: "tab_b", webContentsId: 1 });
    const [first, second] = frames.splice(0);
    second?.show("newer");
    await expect(newer).resolves.toEqual(taken("newer"));
    first?.show("older");
    await expect(older).resolves.toBeNull();
    await expect(readPageThumbnail("tab_b")).resolves.toEqual(taken("newer"));
  });

  it("keeps nothing of a picture that finishes after its tab closed", async () => {
    const taking = capturePageThumbnail({ key: "tab_c", webContentsId: 1 });
    const [frame] = frames.splice(0);
    await forgetPageThumbnails(["tab_c"]);
    frame?.show("closed");
    await expect(taking).resolves.toBeNull();
    await expect(readPageThumbnail("tab_c")).resolves.toBeNull();
  });

  it("keeps nothing of a picture taken while the page moved to another address", async () => {
    const taking = capturePageThumbnail({ key: "tab_e", webContentsId: 1 });
    const [frame] = frames.splice(0);
    guest.url = "https://two.example/";
    frame?.show("between");
    await expect(taking).resolves.toBeNull();
    await expect(readPageThumbnail("tab_e")).resolves.toBeNull();
    guest.url = "https://one.example/";
  });

  it("leaves the newer picture on disk when two finish one after the other", async () => {
    const older = capturePageThumbnail({ key: "tab_d", webContentsId: 1 });
    const newer = capturePageThumbnail({ key: "tab_d", webContentsId: 1 });
    const [first, second] = frames.splice(0);
    first?.show("older");
    second?.show("newer");
    await Promise.all([older, newer]);
    const pictures = path.join(folder, "page-thumbnails");
    const name = createHash("sha1").update("tab_d").digest("hex");
    expect(fs.readFileSync(path.join(pictures, `${name}.jpg`), "utf8")).toBe(
      "newer",
    );
    expect(
      fs.readdirSync(pictures).filter((each) => each.endsWith(".partial")),
    ).toEqual([]);
  });
});
