import { BrowserWindow } from "electron";
import { CancelError, download } from "electron-dl";
import { describe, expect, it, vi } from "vitest";

import { captureServerException } from "./capture-server-exception";
import { saveContextMenuMediaAs } from "./context-menu-download";

vi.mock("electron-dl", () => ({
  CancelError: class MockCancelError extends Error {},
  download: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
}));
vi.mock("./capture-server-exception", () => ({
  captureServerException: vi.fn(),
}));

const browserWindow = new BrowserWindow({});

describe("saveContextMenuMediaAs", () => {
  it("treats a canceled save dialog as a normal outcome", async () => {
    vi.mocked(download).mockRejectedValueOnce(new CancelError());

    await saveContextMenuMediaAs({
      browserWindow,
      url: "https://example.com/video.mp4",
    });

    expect(download).toHaveBeenCalledWith(
      browserWindow,
      "https://example.com/video.mp4",
      { saveAs: true },
    );
    expect(captureServerException).not.toHaveBeenCalled();
  });

  it("captures other download errors", async () => {
    const error = new Error("download failed");
    vi.mocked(download).mockRejectedValueOnce(error);

    await saveContextMenuMediaAs({
      browserWindow,
      url: "https://example.com/video.mp4",
    });

    expect(captureServerException).toHaveBeenCalledWith(error);
  });
});
