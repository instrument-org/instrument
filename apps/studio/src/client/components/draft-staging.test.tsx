import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDraftStaging } from "./draft-staging";
import { type AttachedItem } from "./prompt-input";

// Made with the mock rather than beside it: the factory below is hoisted
// above everything this file declares.
const { stage } = vi.hoisted(() => ({
  stage: vi.fn<(input: unknown) => Promise<{ path: string; size: number }>>(),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: { drafts: { stage: { call: stage } } },
}));

/** What the composer holds for bytes that arrived without a file. */
function pasted(id: string, name: string): AttachedItem {
  return {
    content: "aGk=",
    id,
    mimeType: "image/png",
    name,
    size: 2,
    type: "file",
  } as AttachedItem;
}

/** What the composer hands over for the same bytes at send. */
function sending(name: string) {
  return { content: "aGk=", filename: name, mimeType: "image/png", size: 2 };
}

function staging() {
  return renderHook(() =>
    useDraftStaging({ draftFor: () => "d1", onChange: () => undefined }),
  );
}

/** Lets the staging write settle, which happens a promise later. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  stage.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a draft's pasted files at send", () => {
  it("sends the name the file was written under, not the one pasted twice", async () => {
    stage.mockResolvedValue({
      path: "/ws/Drafts/2026-10-17/image 2.png",
      size: 2,
    });
    const { result } = staging();

    act(() => {
      result.current.keepItems([pasted("i1", "image.png")]);
    });
    await settle();

    const [file] = result.current.asStaged({
      files: [sending("image.png")],
    }).files;

    expect(file).toEqual({
      filename: "image 2.png",
      mimeType: "image/png",
      path: "/ws/Drafts/2026-10-17/image 2.png",
      size: 2,
    });
  });

  it("sends the paste the box still holds, not one taken out before it", async () => {
    stage
      .mockResolvedValueOnce({ path: "/ws/Drafts/d/image.png", size: 2 })
      .mockResolvedValueOnce({ path: "/ws/Drafts/d/image 2.png", size: 2 });
    const { result } = staging();

    act(() => {
      result.current.keepItems([pasted("i1", "image.png")]);
    });
    await settle();
    // Taken out of the box, and another of the same name pasted after it.
    act(() => {
      result.current.keepItems([pasted("i2", "image.png")]);
    });
    await settle();

    const [file] = result.current.asStaged({
      files: [sending("image.png")],
    }).files;

    expect(file).toMatchObject({ path: "/ws/Drafts/d/image 2.png" });
  });
});
