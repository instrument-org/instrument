import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { CapturesGrid } from "./captures-grid";

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      prepareDrag: { call: vi.fn(() => Promise.resolve()) },
    },
  },
}));

/** The bridge the shared preload stub leaves off, since it is Electron-only. */
function installFileDragBridge() {
  const api = window.api;
  const startFileDrag = vi.fn();
  Object.defineProperty(window, "api", {
    configurable: true,
    value: { ...api, startFileDrag },
  });
  onTestFinished(() => {
    Object.defineProperty(window, "api", { configurable: true, value: api });
  });
  return startFileDrag;
}

const capture = {
  name: "Instrument 2026-11-26 at 09.15.00.png",
  path: "/Users/mac-user/.instrument/captures/Instrument 2026-11-26 at 09.15.00.png",
  stamp: Date.now(),
};

describe("CapturesGrid", () => {
  it("drags a capture out as its file, and a press that stays put picks it", () => {
    const startFileDrag = installFileDragBridge();
    const onPick = vi.fn();
    render(<CapturesGrid captures={[capture]} onPick={onPick} />);
    const tile = screen.getByRole("button");
    expect(tile.getAttribute("draggable")).toBe("true");

    fireEvent.click(tile);
    expect(onPick).toHaveBeenCalledWith(capture);

    fireEvent.pointerDown(tile, { clientX: 0, clientY: 0 });
    fireEvent.dragStart(tile);
    fireEvent.pointerMove(window, { clientX: 40, clientY: 0 });
    expect(startFileDrag).toHaveBeenCalledWith([capture.path]);
  });
});
