import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { noop } from "radashi";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StoreId } from "../../schemas/store-id";
import { browserTargetOf } from "../../types";
import { downloadInTab, downloadsFolderPath } from "./agent-browser-download";

const TARGET_ID = browserTargetOf(StoreId.newTabId());

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "agent-download-"));
});
afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

type Listener = (method: string, params: unknown, frame?: string) => void;

/**
 * A tab whose click does what `onClick` says, given the tab's events to
 * send, and which records every command sent to it.
 */
function fakeTab(
  onClick: (tab: {
    detach: () => void;
    emit: Listener;
    sent: { method: string; params: unknown }[];
  }) => void,
) {
  const sent: { method: string; params: unknown }[] = [];
  let listener: Listener = noop;
  let detach: () => void = noop;
  const browser = {
    sendCommand: (_targetId: string, method: string, params: unknown) => {
      sent.push({ method, params });
      return Promise.resolve({});
    },
    subscribeEvents: (
      _targetId: string,
      onDetach: () => void,
      onEvent: Listener,
    ) => {
      listener = onEvent;
      detach = onDetach;
      return noop;
    },
  };
  return {
    // Its overloads are more than a fake needs.
    browser: browser as never,
    click: () => {
      onClick({
        detach: () => {
          detach();
        },
        emit: (...args) => {
          listener(...args);
        },
        sent,
      });
      return Promise.resolve({ exitCode: 0, stderr: "", stdout: "✓ Done\n" });
    },
    sent,
  };
}

/** The app's events for a download that began and ended as `state`. */
function finish(
  emit: Listener,
  state: "canceled" | "completed",
  guid = "guid-1",
) {
  emit("Page.downloadWillBegin", {
    frameId: TARGET_ID,
    guid,
    suggestedFilename: "report.csv",
    url: "https://example.com/report.csv",
  });
  emit("Page.downloadProgress", {
    guid,
    receivedBytes: 4,
    state,
    totalBytes: 4,
  });
}

const QUICK = { beginMs: 20, finishMs: 20 };

describe("downloadInTab", () => {
  it("authorizes the tab for the named file, clicks, and says where it went", async () => {
    const savePath = path.join(dir, "downloads", "report.csv");
    const tab = fakeTab(({ emit }) => {
      writeFileSync(savePath, "a,b\n");
      finish(emit, "completed");
    });

    const result = await downloadInTab({
      ...tab,
      json: false,
      savePath,
      shownPath: "/work/downloads/report.csv",
      targetId: TARGET_ID,
    });

    expect(result).toMatchInlineSnapshot(`
      {
        "exitCode": 0,
        "stderr": "",
        "stdout": "✓ Download saved to /work/downloads/report.csv
      ",
      }
    `);
    // Only the one authorization: the download took it.
    expect(tab.sent).toEqual([
      {
        method: "Browser.setDownloadBehavior",
        params: {
          behavior: "allow",
          downloadPath: path.join(dir, "downloads"),
          eventsEnabled: true,
          fileName: "report.csv",
        },
      },
    ]);
  });

  it("answers in JSON when asked", async () => {
    const savePath = path.join(dir, "report.csv");
    const tab = fakeTab(({ emit }) => {
      writeFileSync(savePath, "");
      finish(emit, "completed");
    });

    const result = await downloadInTab({
      ...tab,
      json: true,
      savePath,
      shownPath: "/work/report.csv",
      targetId: TARGET_ID,
    });

    expect(JSON.parse(result.stdout)).toEqual({
      data: { path: "/work/report.csv" },
      error: null,
      success: true,
    });
  });

  it("follows the download that began first, past another's events", async () => {
    const savePath = path.join(dir, "report.csv");
    const tab = fakeTab(({ emit }) => {
      emit("Page.downloadWillBegin", { guid: "ours" });
      emit("Page.downloadProgress", { guid: "other", state: "canceled" });
      writeFileSync(savePath, "");
      emit("Page.downloadProgress", { guid: "ours", state: "completed" });
    });

    const result = await downloadInTab({
      ...tab,
      json: false,
      savePath,
      shownPath: "report.csv",
      targetId: TARGET_ID,
    });

    expect(result.exitCode).toBe(0);
  });

  it("waits for a download that finishes after the click returns", async () => {
    const savePath = path.join(dir, "report.csv");
    const tab = fakeTab(({ emit }) => {
      setTimeout(() => {
        emit("Page.downloadWillBegin", { guid: "late" });
      }, 5);
      setTimeout(() => {
        writeFileSync(savePath, "");
        emit("Page.downloadProgress", { guid: "late", state: "completed" });
      }, 10);
    });

    const result = await downloadInTab({
      ...tab,
      json: false,
      savePath,
      shownPath: "report.csv",
      targetId: TARGET_ID,
      timeouts: { beginMs: 1000, finishMs: 1000 },
    });

    expect(result.stdout).toBe("✓ Download saved to report.csv\n");
  });

  const unauthorized = {
    method: "Browser.setDownloadBehavior",
    params: { behavior: "default" },
  };

  it.each([
    {
      name: "a canceled download",
      onClick: ({ emit }: { emit: Listener }) => {
        finish(emit, "canceled");
      },
      stderr: "✗ Download was canceled\n",
      takesBack: false,
    },
    {
      name: "a click that starts none",
      onClick: noop,
      stderr: "✗ No download began within 0.02s of the click\n",
      takesBack: true,
    },
    {
      name: "a download still running",
      onClick: ({ emit }: { emit: Listener }) => {
        emit("Page.downloadWillBegin", { guid: "slow" });
      },
      stderr:
        "✗ The download was still running after 0.02s; it is saved to report.csv once it finishes\n",
      takesBack: false,
    },
    {
      name: "a tab that closes",
      onClick: ({ detach }: { detach: () => void }) => {
        detach();
      },
      stderr: "✗ The tab closed before the download finished\n",
      takesBack: true,
    },
    {
      name: "a download that left no file",
      onClick: ({ emit }: { emit: Listener }) => {
        finish(emit, "completed");
      },
      stderr: "✗ Download completed but no file is at report.csv\n",
      takesBack: false,
    },
  ])("fails for $name", async ({ onClick, stderr, takesBack }) => {
    const tab = fakeTab(onClick);

    const result = await downloadInTab({
      ...tab,
      json: false,
      savePath: path.join(dir, "report.csv"),
      shownPath: "report.csv",
      targetId: TARGET_ID,
      timeouts: QUICK,
    });

    expect(result).toEqual({ exitCode: 1, stderr, stdout: "" });
    // A download that began took the authorization with it.
    expect(tab.sent.map(({ params }) => params)).toEqual([
      expect.objectContaining({ behavior: "allow" }),
      ...(takesBack ? [unauthorized.params] : []),
    ]);
  });

  it("hands back a click that failed, and takes the authorization back", async () => {
    const tab = fakeTab(noop);
    const failed = {
      exitCode: 1,
      stderr: "✗ Element not found\n",
      stdout: "",
    };

    const result = await downloadInTab({
      ...tab,
      click: () => Promise.resolve(failed),
      json: false,
      savePath: path.join(dir, "report.csv"),
      shownPath: "report.csv",
      targetId: TARGET_ID,
    });

    expect(result).toBe(failed);
    expect(tab.sent.at(-1)).toEqual(unauthorized);
  });

  it("stops waiting when the command is stopped", async () => {
    const tab = fakeTab(noop);
    const stop = new AbortController();
    setTimeout(() => {
      stop.abort();
    }, 5);

    const result = await downloadInTab({
      ...tab,
      json: false,
      savePath: path.join(dir, "report.csv"),
      shownPath: "report.csv",
      signal: stop.signal,
      targetId: TARGET_ID,
      timeouts: { beginMs: 10_000, finishMs: 10_000 },
    });

    expect(result.stderr).toBe("✗ Stopped before the download finished\n");
    expect(tab.sent.at(-1)).toEqual(unauthorized);
  });
});

describe("downloadsFolderPath", () => {
  it.each([
    ["report.csv", "/work/downloads/report.csv"],
    [".hidden", "/work/downloads/.hidden"],
    ["out/report.csv", "out/report.csv"],
    ["./report.csv", "./report.csv"],
    ["/tmp/report.csv", "/tmp/report.csv"],
    [String.raw`C:\Users\x\report.csv`, String.raw`C:\Users\x\report.csv`],
    ["..", ".."],
  ])("places %j at %j", (named, placed) => {
    expect(downloadsFolderPath(named, "/work/downloads")).toBe(placed);
  });
});
