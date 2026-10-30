import { describe, expect, it } from "vitest";

import {
  admitPreview,
  attachedPreviews,
  EMPTY_PREVIEW_POOL,
  type PreviewPool,
} from "./file-system-preview-pool";

const admit = (...paths: string[]) =>
  paths.reduce<PreviewPool>(
    (pool, path) => admitPreview(pool, path, 3),
    EMPTY_PREVIEW_POOL,
  );

describe("admitPreview", () => {
  it("keeps paths in the order they joined, whatever was shown since", () => {
    expect(admit("a", "b", "c", "a").paths).toEqual(["a", "b", "c"]);
  });

  it("evicts the one shown longest ago, not the one that joined first", () => {
    expect(admit("a", "b", "c", "a", "d").paths).toEqual(["a", "c", "d"]);
  });

  it("hands back a new pool even when the newest is admitted again", () => {
    const pool = admit("a", "b");
    const again = admitPreview(pool, "b", 3);
    expect(again).not.toBe(pool);
    expect(again.paths).toEqual(["a", "b"]);
  });

  it("forgets when an evicted path was shown", () => {
    expect(admit("a", "b", "c", "d").shownAt.has("a")).toBe(false);
  });
});

describe("attachedPreviews", () => {
  it("attaches the most recently shown, newest first", () => {
    expect(attachedPreviews(admit("a", "b", "c", "a"), 2, null)).toEqual([
      "a",
      "c",
    ]);
  });

  it("attaches the dialog's preview too, wherever it ranks", () => {
    expect(attachedPreviews(admit("a", "b", "c"), 2, "a")).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("ignores a dialog path the pool has not admitted", () => {
    expect(attachedPreviews(admit("a", "b"), 2, "z")).toEqual(["b", "a"]);
  });
});
