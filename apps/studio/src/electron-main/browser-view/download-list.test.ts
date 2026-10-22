import type { DownloadItem } from "electron";

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

// Each workspace's saved list, by the order its store was opened in.
const saved = vi.hoisted(() => [] as { downloads: unknown[] }[]);
vi.mock("@/electron-main/stores/workspace/downloads", () => ({
  getDownloadsStore: () => {
    const own = { downloads: [] as unknown[] };
    saved.push(own);
    return {
      get: () => own.downloads,
      set: (_key: string, value: unknown[]) => {
        own.downloads = value;
      },
    };
  },
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: { publish: vi.fn() },
}));

import {
  currentWorkspaceScope,
  openWorkspaceScope,
} from "@/electron-main/lib/workspace-scope";

import { listDownloads, trackDownload } from "./download-list";

/** A transfer under way, as Chromium hands one over. */
function transfer() {
  return Object.assign(new EventEmitter(), {
    getFilename: () => "report.pdf",
    getReceivedBytes: () => 10,
    getSavePath: () => "/Downloads/report.pdf",
    getTotalBytes: () => 10,
    getURL: () => "https://example.com/report.pdf",
  });
}

describe("a download across a workspace switch", () => {
  it("finishes into the list of the workspace it started in", async () => {
    const item = transfer();
    // A stand-in for Electron's DownloadItem: the list reads only these.
    trackDownload(item as unknown as DownloadItem, "/Downloads/report.pdf");
    await currentWorkspaceScope().close(() => undefined);
    openWorkspaceScope();

    item.emit("done", {}, "completed");

    expect(saved[0]?.downloads).toEqual([
      expect.objectContaining({ filename: "report.pdf", state: "completed" }),
    ]);
    expect(listDownloads()).toEqual([]);
  });
});
