import { type BrowserDownload } from "@/electron-main/stores/workspace/downloads";
import { describe, expect, it } from "vitest";

import {
  downloadDelta,
  type DownloadQuery,
  downloadSubpath,
  searchDownloads,
  toChromeDownload,
} from "./extension-downloads";

const START = Date.parse("2026-11-27T10:00:00Z");

function listed(
  patch: Partial<BrowserDownload> & Pick<BrowserDownload, "state">,
): BrowserDownload {
  return {
    filename: "report.pdf",
    id: "list-id",
    path: "/Users/mac-user/Downloads/report.pdf",
    receivedBytes: 500,
    startedAt: START,
    totalBytes: 1000,
    url: "https://example.com/report.pdf",
    ...patch,
  };
}

describe("toChromeDownload", () => {
  it("reads each state of the list's as Chrome names it", () => {
    const cases = {
      canceled: listed({ endedAt: START + 1000, state: "canceled" }),
      completed: listed({
        endedAt: START + 5000,
        receivedBytes: 1000,
        state: "completed",
      }),
      failed: listed({
        endedAt: START + 1000,
        path: null,
        state: "failed",
        totalBytes: 0,
      }),
      interrupted: listed({ state: "interrupted" }),
      paused: listed({ state: "progressing" }),
      progressing: listed({ state: "progressing" }),
    };
    expect(
      Object.fromEntries(
        Object.entries(cases).map(([name, download]) => {
          const item = toChromeDownload(download, {
            exists: name === "completed",
            id: 7,
            ...(name === "paused"
              ? { live: { mime: "application/pdf", paused: true } }
              : {}),
          });
          return [
            name,
            [
              item.state,
              item.paused && "paused",
              item.canResume && "can resume",
              item.error,
              item.endTime,
              `${item.fileSize}/${item.totalBytes}`,
              item.filename || "(no file)",
            ]
              .filter(Boolean)
              .join(" "),
          ];
        }),
      ),
    ).toMatchInlineSnapshot(`
      {
        "canceled": "interrupted USER_CANCELED 2026-11-27T10:00:01.000Z 1000/1000 /Users/mac-user/Downloads/report.pdf",
        "completed": "complete 2026-11-27T10:00:05.000Z 1000/1000 /Users/mac-user/Downloads/report.pdf",
        "failed": "interrupted FILE_FAILED 2026-11-27T10:00:01.000Z -1/-1 (no file)",
        "interrupted": "interrupted can resume NETWORK_FAILED 1000/1000 /Users/mac-user/Downloads/report.pdf",
        "paused": "in_progress paused can resume 1000/1000 /Users/mac-user/Downloads/report.pdf",
        "progressing": "in_progress 1000/1000 /Users/mac-user/Downloads/report.pdf",
      }
    `);
  });

  it("names the extension that started it", () => {
    expect(
      toChromeDownload(listed({ state: "progressing" }), {
        by: { id: "kgdh", name: "Probe" },
        exists: false,
        id: 1,
      }),
    ).toMatchObject({ byExtensionId: "kgdh", byExtensionName: "Probe" });
  });
});

describe("searchDownloads", () => {
  const items = [
    listed({ state: "completed", endedAt: START + 10, receivedBytes: 1000 }),
    listed({
      filename: "photo.jpg",
      path: "/Users/mac-user/Downloads/photo.jpg",
      startedAt: START + 60_000,
      state: "progressing",
      totalBytes: 50,
      url: "https://images.example.org/photo.jpg",
    }),
    listed({
      startedAt: START + 120_000,
      state: "canceled",
      url: "https://example.com/other.zip",
    }),
  ].map((download, index) =>
    toChromeDownload(download, {
      exists: download.state === "completed",
      id: index + 1,
    }),
  );
  const ids = (query: Parameters<typeof searchDownloads>[1]) =>
    searchDownloads(items, query).map(({ id }) => id);

  it.each([
    [{}, [3, 2, 1]],
    [{ orderBy: ["startTime"] }, [1, 2, 3]],
    [{ limit: 1 }, [3]],
    [{ limit: 0 }, [3, 2, 1]],
    [{ id: 2 }, [2]],
    [{ state: "complete" }, [1]],
    [{ exists: true }, [1]],
    [{ query: ["example.com"] }, [3, 1]],
    [{ query: ["example", "-zip"] }, [2, 1]],
    [{ urlRegex: "\\.jpg$" }, [2]],
    [{ urlRegex: "(" }, []],
    [{ filenameRegex: "photo" }, [2]],
    [{ totalBytesGreater: 100 }, [3, 1]],
    [{ startedAfter: new Date(START + 1).toISOString() }, [3, 2]],
    [{ endedBefore: new Date(START + 100).toISOString() }, [1]],
    [{ error: "USER_CANCELED" }, [3]],
  ] satisfies [DownloadQuery, number[]][])(
    "answers %j with %j",
    (query, expected) => {
      expect(ids(query)).toEqual(expected);
    },
  );
});

describe("downloadDelta", () => {
  it("tells what changed and nothing for progress alone", () => {
    const running = toChromeDownload(listed({ state: "progressing" }), {
      exists: false,
      id: 4,
    });
    expect(
      downloadDelta(running, { ...running, bytesReceived: 900 }),
    ).toBeNull();
    expect(
      downloadDelta(
        running,
        toChromeDownload(
          listed({
            endedAt: START + 3000,
            receivedBytes: 1000,
            state: "completed",
          }),
          { exists: true, id: 4 },
        ),
      ),
    ).toMatchInlineSnapshot(`
      {
        "endTime": {
          "current": "2026-11-27T10:00:03.000Z",
        },
        "exists": {
          "current": true,
          "previous": false,
        },
        "id": 4,
        "state": {
          "current": "complete",
          "previous": "in_progress",
        },
      }
    `);
  });
});

describe("downloadSubpath", () => {
  it.each([
    ["report.pdf", "report.pdf"],
    ["reports/2026/report.pdf", "reports/2026/report.pdf"],
    ["reports\\report.pdf", "reports/report.pdf"],
    ["", null],
    ["/etc/passwd", null],
    ["../outside.txt", null],
    ["reports/../../outside.txt", null],
    ["./report.pdf", null],
    ["C:\\report.pdf", null],
    ["reports//report.pdf", null],
  ])("reads %j as %j", (filename, expected) => {
    expect(downloadSubpath(filename)).toBe(expected);
  });
});
