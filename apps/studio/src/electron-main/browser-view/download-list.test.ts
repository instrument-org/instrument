import type { DownloadItem } from "electron";

import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The list's saved copy, in memory; kept across a fresh import of the module,
// which is what a relaunch looks like to it.
const saved = vi.hoisted(() => ({ downloads: [] as unknown[] }));
vi.mock("@/electron-main/stores/workspace/downloads", () => ({
  getDownloadsStore: () => ({
    get: () => saved.downloads,
    set: (_key: string, value: unknown[]) => {
      saved.downloads = value;
    },
  }),
}));

// A fresh module, with nothing in memory but what was saved.
async function launch() {
  vi.resetModules();
  return import("./download-list");
}

function makeItem(filename = "report.pdf", savePath = "") {
  let received = 0;
  const emitter = new EventEmitter();
  const cancel = vi.fn(() => {
    emitter.emit("done", {}, "cancelled");
  });
  const item = Object.assign(emitter, {
    cancel,
    getFilename: () => filename,
    getReceivedBytes: () => received,
    getSavePath: () => savePath,
    getTotalBytes: () => 2048,
    getURL: () => `https://example.com/${filename}`,
  });
  return {
    cancel,
    finish: () => {
      received = 2048;
      emitter.emit("done", {}, "completed");
    },
    item: item as unknown as DownloadItem,
    interrupt: () => {
      emitter.emit("updated", {}, "interrupted");
    },
    progress: (bytes: number) => {
      received = bytes;
      emitter.emit("updated", {}, "progressing");
    },
  };
}

beforeEach(() => {
  saved.downloads = [];
});

describe("download list", () => {
  it("follows a download's progress to the end", async () => {
    const list = await launch();
    const download = makeItem();
    list.trackDownload(download.item, "/nowhere/report.pdf");
    download.progress(512);

    expect(list.listDownloads()[0]).toMatchObject({
      receivedBytes: 512,
      state: "progressing",
      totalBytes: 2048,
    });

    download.finish();
    expect(list.listDownloads()[0]).toMatchObject({
      // Saved somewhere no file is.
      exists: false,
      receivedBytes: 2048,
      state: "completed",
    });
  });

  it("says a download the network dropped is interrupted until it resumes", async () => {
    const list = await launch();
    const download = makeItem();
    list.trackDownload(download.item, "/nowhere/report.pdf");
    download.interrupt();
    expect(list.listDownloads()[0]?.state).toBe("interrupted");

    list.clearDownloads();
    download.progress(1024);
    expect(list.listDownloads()[0]?.state).toBe("progressing");
  });

  it("reads a download still running at the last quit as failed", async () => {
    const before = await launch();
    before.trackDownload(makeItem().item, "/nowhere/report.pdf");

    const after = await launch();
    expect(after.listDownloads().map((d) => d.state)).toEqual(["failed"]);
  });

  it("clears the finished downloads and keeps the running ones", async () => {
    const list = await launch();
    const done = makeItem("done.pdf");
    list.trackDownload(done.item, "/nowhere/done.pdf");
    done.finish();
    list.trackDownload(makeItem("running.pdf").item, "/nowhere/running.pdf");

    list.clearDownloads();

    expect(list.listDownloads().map((d) => d.filename)).toEqual([
      "running.pdf",
    ]);
  });

  it("stops a running download and lists it as stopped", async () => {
    const list = await launch();
    const download = makeItem();
    list.trackDownload(download.item, "/nowhere/report.pdf");
    const id = list.listDownloads()[0]?.id ?? "";

    list.cancelDownload(id);

    expect(download.cancel).toHaveBeenCalledOnce();
    expect(list.listDownloads()[0]?.state).toBe("canceled");
  });

  it("keeps a running download on the list when asked to remove it", async () => {
    const list = await launch();
    list.trackDownload(makeItem().item, "/nowhere/report.pdf");
    const id = list.listDownloads()[0]?.id ?? "";

    list.removeDownload(id);

    expect(list.listDownloads()).toHaveLength(1);
  });

  it("shows the newest hundred finished downloads and keeps a thousand for Activity", async () => {
    const list = await launch();
    for (let n = 0; n < 1001; n++) {
      const download = makeItem(`file-${n}.pdf`);
      list.trackDownload(download.item, `/nowhere/file-${n}.pdf`);
      download.finish();
    }

    const names = list.listDownloads().map((d) => d.filename);
    expect(names).toHaveLength(100);
    expect(names.at(0)).toBe("file-1000.pdf");
    expect(names.at(-1)).toBe("file-901.pdf");
    const kept = list.downloadsBetween({ since: 0, until: Date.now() });
    expect(kept).toHaveLength(1000);
    expect(kept.at(-1)).toMatchObject({ path: "/nowhere/file-1.pdf" });
  });
});

describe("downloads as Activity reads them", () => {
  const NOW = Date.UTC(2026, 10, 6, 20, 30);
  const MIN = 60_000;

  /** A download that ends `minutesAgo` before NOW, from `url`. */
  function finishedAt(
    list: Awaited<ReturnType<typeof launch>>,
    name: string,
    minutesAgo: number,
    url = `https://example.com/${name}`,
  ) {
    vi.setSystemTime(NOW - minutesAgo * MIN);
    const download = makeItem(name);
    Object.assign(download.item, { getURL: () => url });
    list.trackDownload(download.item, `/Users/mac-user/Downloads/${name}`);
    download.finish();
  }

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    return () => {
      vi.useRealTimers();
    };
  });

  it("reads the whole downloads in a range, newest first, each from its address without the query", async () => {
    const list = await launch();
    finishedAt(list, "old.pdf", 90);
    finishedAt(
      list,
      "nda.pdf",
      20,
      "https://files.example.com/nda.pdf?token=s3cr3t#page=2",
    );
    finishedAt(list, "w9.pdf", 10);
    const stopped = makeItem("stopped.pdf");
    list.trackDownload(stopped.item, "/Users/mac-user/Downloads/stopped.pdf");
    stopped.cancel();

    expect(list.downloadsBetween({ since: NOW - 60 * MIN, until: NOW }))
      .toMatchInlineSnapshot(`
      [
        {
          "at": "2026-11-06T20:20:00.000Z",
          "kind": "download",
          "path": "/Users/mac-user/Downloads/w9.pdf",
          "url": "https://example.com/w9.pdf",
        },
        {
          "at": "2026-11-06T20:10:00.000Z",
          "kind": "download",
          "path": "/Users/mac-user/Downloads/nda.pdf",
          "url": "https://files.example.com/nda.pdf",
        },
      ]
    `);
    expect(
      list.downloadsBetween({ limit: 1, since: 0, until: NOW }),
    ).toMatchObject([{ path: "/Users/mac-user/Downloads/w9.pdf" }]);
  });

  it("clears the downloads that ended from a time on, keeping those before it", async () => {
    const list = await launch();
    finishedAt(list, "old.pdf", 90);
    finishedAt(list, "new.pdf", 10);

    list.clearDownloads(NOW - 60 * MIN);

    expect(list.listDownloads().map((d) => d.filename)).toEqual(["old.pdf"]);
  });

  it("removes a download Activity names by where it landed and when it ended", async () => {
    const list = await launch();
    finishedAt(list, "w9.pdf", 90);
    finishedAt(list, "w9.pdf", 10);
    const at = NOW - 10 * MIN;

    list.removeDownloadsAt([
      { at, path: "/Users/mac-user/Downloads/w9.pdf", since: at },
    ]);

    expect(list.listDownloads().map((d) => d.endedAt)).toEqual([
      NOW - 90 * MIN,
    ]);
  });
});
