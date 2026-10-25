import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Draft } from "@/shared/drafts";

import { itemsOf, useDraftStaging, useFolderItems } from "./draft-staging";
import { type AttachedItem, type PromptInputRef } from "./prompt-input";

// Made with the mock rather than beside it: the factory below is hoisted
// above everything this file declares.
const { stage, trash } = vi.hoisted(() => ({
  stage: vi.fn<(input: unknown) => Promise<{ path: string; size: number }>>(),
  trash: vi.fn<(input: unknown) => Promise<void>>(),
}));

vi.mock("@/client/drafts/store", () => ({
  stageIntoDraft: stage,
  trashFromDraft: trash,
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
  trash.mockReset();
  trash.mockResolvedValue(undefined);
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

describe("an item taken out of the box", () => {
  it("goes to the Trash by its path", () => {
    const { result } = staging();
    result.current.removeItem({
      id: "f",
      mimeType: "application/pdf",
      name: "quote.pdf",
      path: "/ws/Drafts/d/quote.pdf",
      size: 4,
      type: "file",
    });
    expect(trash).toHaveBeenCalledWith({
      draftId: "d1",
      path: "/ws/Drafts/d/quote.pdf",
    });
  });

  it("goes to the Trash once its paste lands, where it was taken out while being written", async () => {
    let land = (_: { path: string; size: number }) => {};
    stage.mockReturnValue(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    const { result } = staging();
    const item = pasted("i1", "image.png");
    act(() => {
      result.current.keepItems([item]);
    });
    result.current.removeItem(item);
    expect(trash).not.toHaveBeenCalled();

    land({ path: "/ws/Drafts/d/image.png", size: 2 });
    await settle();

    expect(trash).toHaveBeenCalledWith({
      draftId: "d1",
      path: "/ws/Drafts/d/image.png",
    });
    expect(result.current.knows("/ws/Drafts/d/image.png")).toBe(false);
  });
});

describe("a box following its draft's folder", () => {
  const file = (name: string) => ({
    kind: "file" as const,
    mediaType: "image/png",
    name,
    path: `/ws/Drafts/d/${name}`,
    size: 2,
  });
  const withFolder = (names: string[]): Draft => ({
    createdAt: 1,
    id: "d1",
    ...(names.length > 0 ? { inFolder: names.map(file) } : {}),
    updatedAt: 1,
    words: "",
  });

  function follow({
    held = [file("a.png")].map((item) => ({
      id: "held",
      mimeType: item.mediaType,
      name: item.name,
      path: item.path,
      size: item.size,
      type: "file" as const,
    })),
    knows = () => false,
    forget = () => [],
  }: {
    forget?: (path: string) => string[];
    held?: AttachedItem[];
    knows?: (path: string) => boolean;
  } = {}) {
    const mergeItems = vi.fn<PromptInputRef["mergeItems"]>();
    const input = {
      current: { mergeItems, snapshot: () => ({ items: held, prompt: "" }) },
    };
    const hook = renderHook(
      ({ draft }: { draft: Draft }) => {
        useFolderItems({ draft, input, staging: { forget, knows } });
      },
      { initialProps: { draft: withFolder(["a.png"]) } },
    );
    return { hook, mergeItems };
  }

  it("adds a file dropped into the folder and drops one taken out, not what it opened with", () => {
    const { hook, mergeItems } = follow();
    expect(mergeItems).not.toHaveBeenCalled();

    hook.rerender({ draft: withFolder(["a.png", "b.png"]) });
    expect(mergeItems).toHaveBeenLastCalledWith({
      added: [expect.objectContaining({ path: "/ws/Drafts/d/b.png" })],
      gone: [],
    });

    hook.rerender({ draft: withFolder(["b.png"]) });
    expect(mergeItems).toHaveBeenLastCalledWith({
      added: [],
      gone: ["/ws/Drafts/d/a.png"],
    });
  });

  it("leaves out a paste the box already shows by its bytes", () => {
    const { hook, mergeItems } = follow({
      knows: (path) => path === "/ws/Drafts/d/pasted.png",
    });
    hook.rerender({ draft: withFolder(["a.png", "pasted.png"]) });
    expect(mergeItems).not.toHaveBeenCalled();
  });

  it("adds what the folder has that a box put back from where it was put away does not show", () => {
    const { mergeItems } = follow({ held: [] });
    expect(mergeItems).toHaveBeenCalledWith({
      added: [expect.objectContaining({ path: "/ws/Drafts/d/a.png" })],
      gone: [],
    });
  });

  it("leaves out what the draft records the box was given, which a restore has not drawn yet", () => {
    const mergeItems = vi.fn<PromptInputRef["mergeItems"]>();
    // The box's snapshot still reads the render before the restore.
    const input = {
      current: { mergeItems, snapshot: () => ({ items: [], prompt: "" }) },
    };
    renderHook(() => {
      useFolderItems({
        draft: {
          ...withFolder(["image 2.png"]),
          attached: [file("image 2.png")],
        },
        input,
        staging: { forget: () => [], knows: () => false },
      });
    });
    expect(mergeItems).not.toHaveBeenCalled();
  });

  it("takes out a paste the box shows by its bytes when its file leaves the folder", () => {
    const { hook, mergeItems } = follow({
      forget: (path) => (path === "/ws/Drafts/d/a.png" ? ["paste-1"] : []),
    });
    hook.rerender({ draft: withFolder([]) });
    expect(mergeItems).toHaveBeenLastCalledWith({
      added: [],
      gone: ["/ws/Drafts/d/a.png", "paste-1"],
    });
  });

  it("opens with what the composer was given and what the folder has, each once", () => {
    const items = itemsOf({
      ...withFolder(["a.png", "b.png"]),
      attached: [file("a.png")],
    });
    expect(items.map((item) => ("path" in item ? item.path : ""))).toEqual([
      "/ws/Drafts/d/a.png",
      "/ws/Drafts/d/b.png",
    ]);
  });
});
