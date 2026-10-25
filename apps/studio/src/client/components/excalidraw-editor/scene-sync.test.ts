import { describe, expect, it } from "vitest";

import {
  mergeScene,
  newFiles,
  readScene,
  type Restore,
  type SceneElement,
  spliceScene,
} from "./scene-sync";

/** A saved file's JSON, as the tests read it back (`as`: JSON.parse returns `any`). */
function written(text: string) {
  return JSON.parse(text) as { elements: SceneElement[]; files?: unknown };
}

/**
 * Stands in for Excalidraw's `restoreElements(x, null)`, which needs a
 * browser: fills the defaults a terse element leaves out, and makes up the
 * bookkeeping at random the way the real one does.
 */
const restore: Restore = (raw) =>
  raw.map((element) => ({
    angle: 0,
    isDeleted: false,
    strokeColor: "#1e1e1e",
    version: 1,
    ...element,
    seed: element.seed ?? Math.floor(Math.random() * 1e9),
    updated: Date.now() + Math.random(),
    versionNonce: element.versionNonce ?? Math.floor(Math.random() * 1e9),
  }));

const rect = (id: string, extra: Record<string, unknown> = {}) => ({
  angle: 0,
  height: 50,
  id,
  isDeleted: false,
  seed: 1,
  strokeColor: "#1e1e1e",
  type: "rectangle",
  version: 3,
  versionNonce: 7,
  width: 100,
  x: 0,
  y: 0,
  ...extra,
});

const file = (elements: unknown[], files?: Record<string, unknown>) =>
  JSON.stringify(
    {
      appState: { viewBackgroundColor: "#ffffff" },
      elements,
      files: files ?? {},
      source: "https://excalidraw.com",
      type: "excalidraw",
      version: 2,
    },
    null,
    2,
  );

function scene(text: string) {
  const read = readScene(text, restore);
  if (!read) {
    throw new Error("not a scene");
  }
  return read;
}

/** The canvas after the person's edits: the disk's elements with changes made the way Excalidraw makes them. */
function edit(
  elements: readonly SceneElement[],
  changes: Record<string, Record<string, unknown>>,
) {
  return elements.map((element) => {
    const change = changes[element.id];
    return change
      ? {
          ...element,
          ...change,
          version: (element.version ?? 0) + 1,
          versionNonce: 99,
        }
      : element;
  });
}

const get = (elements: readonly SceneElement[], id: string) =>
  elements.find((element) => element.id === id);

describe("mergeScene", () => {
  it("takes an agent's move that does not bump version while the person edits another element", () => {
    const base = scene(file([rect("a"), rect("b", { x: 200 })]));
    const ours = edit(base.elements, { b: { strokeColor: "#e03131" } });
    const theirs = scene(
      file([rect("a", { x: 40, y: 60 }), rect("b", { x: 200 })]),
    );
    const merged = mergeScene({
      base: base.elements,
      ours,
      theirs: theirs.elements,
    });
    expect(get(merged.elements, "a")).toMatchObject({ x: 40, y: 60 });
    expect(get(merged.elements, "b")).toMatchObject({
      strokeColor: "#e03131",
      x: 200,
    });
    expect(merged.changed).toEqual(["a"]);
    expect(merged.conflicts).toBe(0);
    // Bumped above both sides, so the canvas redraws it.
    expect(get(merged.elements, "a")?.version).toBeGreaterThan(3);
    // The person's element is the canvas's own object.
    expect(get(merged.elements, "b")).toBe(get(ours, "b"));
  });

  it("merges different properties of one element", () => {
    const base = scene(file([rect("a")]));
    const ours = edit(base.elements, { a: { strokeColor: "#2f9e44" } });
    const theirs = scene(file([rect("a", { width: 300 })]));
    const merged = mergeScene({
      base: base.elements,
      ours,
      theirs: theirs.elements,
    });
    expect(get(merged.elements, "a")).toMatchObject({
      strokeColor: "#2f9e44",
      width: 300,
    });
    expect(merged.conflicts).toBe(0);
  });

  it("keeps the person's value when both change the same property", () => {
    const base = scene(file([rect("a")]));
    const ours = edit(base.elements, { a: { x: 10 } });
    const theirs = scene(file([rect("a", { x: 500, y: 5 })]));
    const merged = mergeScene({
      base: base.elements,
      ours,
      theirs: theirs.elements,
    });
    expect(get(merged.elements, "a")).toMatchObject({ x: 10, y: 5 });
    expect(merged.conflicts).toBe(1);
  });

  it("deletes an element the agent left out", () => {
    const base = scene(file([rect("a"), rect("b")]));
    const theirs = scene(file([rect("b")]));
    const merged = mergeScene({
      base: base.elements,
      ours: base.elements,
      theirs: theirs.elements,
    });
    expect(get(merged.elements, "a")).toMatchObject({ isDeleted: true });
    expect(get(merged.elements, "b")?.isDeleted).toBe(false);
  });

  it("keeps an element the agent left out when the person was changing it", () => {
    const base = scene(file([rect("a"), rect("b")]));
    const ours = edit(base.elements, { a: { x: 70 } });
    const theirs = scene(file([rect("b")]));
    const merged = mergeScene({
      base: base.elements,
      ours,
      theirs: theirs.elements,
    });
    expect(get(merged.elements, "a")).toMatchObject({
      isDeleted: false,
      x: 70,
    });
    expect(merged.conflicts).toBe(1);
  });

  it("deletes an element the agent tombstoned", () => {
    const base = scene(file([rect("a"), rect("b")]));
    const theirs = scene(file([rect("a", { isDeleted: true }), rect("b")]));
    const merged = mergeScene({
      base: base.elements,
      ours: base.elements,
      theirs: theirs.elements,
    });
    expect(get(merged.elements, "a")).toMatchObject({ isDeleted: true });
  });

  it("adds terse elements, in the agent's order, under ids that hold across reads", () => {
    const base = scene(file([rect("a"), rect("b")]));
    const terse = { height: 40, type: "ellipse", width: 40, x: 300, y: 300 };
    const text = file([rect("a"), terse, rect("b")]);
    const theirs = scene(text);
    const merged = mergeScene({
      base: base.elements,
      ours: base.elements,
      theirs: theirs.elements,
    });
    expect(merged.elements.map((element) => element.type)).toEqual([
      "rectangle",
      "ellipse",
      "rectangle",
    ]);
    const added = merged.elements[1];
    expect(added).toMatchObject({
      angle: 0,
      isDeleted: false,
      type: "ellipse",
      x: 300,
    });
    // Read again, the same text names the same element, so a second merge
    // against it is not a second ellipse.
    expect(scene(text).elements[1]?.id).toBe(added?.id);
    const again = mergeScene({
      base: theirs.elements,
      ours: merged.elements,
      theirs: scene(text).elements,
    });
    expect(
      again.elements.filter((element) => element.type === "ellipse"),
    ).toHaveLength(1);
    expect(again.changed).toEqual([]);
  });

  it("leaves the canvas alone when the disk did not change", () => {
    const base = scene(file([rect("a")]));
    const ours = edit(base.elements, { a: { x: 9 } });
    // Restoring the same text again makes up new bookkeeping, which is no change.
    const merged = mergeScene({
      base: base.elements,
      ours,
      theirs: scene(base.text).elements,
    });
    expect(merged.elements).toEqual(ours);
    expect(merged.changed).toEqual([]);
  });
});

describe("newFiles", () => {
  it("hands over the images the canvas does not have", () => {
    const image = {
      dataURL: "data:image/png;base64,AAAA",
      id: "f1",
      mimeType: "image/png",
    };
    const theirs = scene(
      file([rect("i", { fileId: "f1", type: "image" })], { f1: image }),
    );
    expect(newFiles({ ours: {}, theirs: theirs.files })).toEqual([image]);
    expect(newFiles({ ours: { f1: image }, theirs: theirs.files })).toEqual([]);
  });
});

describe("spliceScene", () => {
  it("writes nothing new when nothing changed, whatever the bookkeeping", () => {
    const text = file([rect("a"), rect("b")]);
    const disk = scene(text);
    const canvas = scene(text).elements;
    expect(spliceScene({ disk, elements: canvas, files: {} })).toBe(text);
  });

  it("keeps the bytes of untouched elements, unknown keys and odd formatting included", () => {
    const text = `{
  "type": "excalidraw",
  "elements": [
    {"id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 1, "height": 1, "custom": {"keep": true}},
    {"id": "b", "type": "rectangle", "x": 5, "y": 5, "width": 1, "height": 1}
  ],
  "appState": {"zoom": {"value": 2}}
}`;
    const disk = scene(text);
    const canvas = edit(disk.elements, { b: { x: 50 } });
    const out = spliceScene({ disk, elements: canvas, files: {} });
    expect(out).toContain(
      `{"id": "a", "type": "rectangle", "x": 0, "y": 0, "width": 1, "height": 1, "custom": {"keep": true}}`,
    );
    expect(out).toContain(`"appState": {"zoom": {"value": 2}}`);
    expect(JSON.parse(out ?? "")).toMatchObject({
      elements: [{ id: "a" }, { id: "b", x: 50 }],
    });
  });

  it("drops deleted elements, adds new ones, and follows the canvas order", () => {
    const disk = scene(file([rect("a"), rect("b")]));
    const canvas = [
      { ...rect("c"), version: 1 },
      ...edit(disk.elements, { a: { isDeleted: true } }),
    ];
    const out = written(
      spliceScene({ disk, elements: canvas, files: {} }) ?? "",
    );
    expect(out.elements.map((element: SceneElement) => element.id)).toEqual([
      "c",
      "b",
    ]);
  });

  it("writes an element the file named no id for in full, so it has one after", () => {
    const text = file([{ height: 10, type: "diamond", width: 10, x: 1, y: 1 }]);
    const disk = scene(text);
    const out = spliceScene({ disk, elements: disk.elements, files: {} });
    const first = written(out ?? "").elements[0];
    expect(first?.id).toBe(disk.elements[0]?.id);
    expect(first).toMatchObject({ angle: 0, type: "diamond" });
  });

  it("adds an image the person pasted to files", () => {
    const disk = scene(file([rect("a")]));
    const image = {
      dataURL: "data:image/png;base64,AAAA",
      id: "f9",
      mimeType: "image/png",
    };
    const canvas = [
      ...disk.elements,
      { ...rect("img", { fileId: "f9", type: "image" }) },
    ];
    const out = spliceScene({ disk, elements: canvas, files: { f9: image } });
    expect(written(out ?? "").files).toEqual({ f9: image });
  });

  it("keeps an element the canvas never took, where a deleted one goes", () => {
    const tiny = `{"id": "t", "type": "text", "text": "no size"}`;
    const text = `{
  "elements": [
    ${JSON.stringify(rect("a"))},
    ${tiny},
    ${JSON.stringify(rect("b"))}
  ]
}`;
    const disk = scene(text);
    // The canvas dropped "t" on load and the person deleted "b".
    const canvas = edit(
      disk.elements.filter((element) => element.id !== "t"),
      { a: { x: 1 }, b: { isDeleted: true } },
    );
    const out = spliceScene({ disk, elements: canvas, files: {} }) ?? "";
    expect(out).toContain(tiny);
    expect(
      written(out).elements.map((element: SceneElement) => element.id),
    ).toEqual(["a", "t"]);
  });

  it("hands an empty file back to the caller to serialize whole", () => {
    expect(
      spliceScene({ disk: scene(""), elements: [], files: {} }),
    ).toBeNull();
  });
});

describe("readScene", () => {
  it("is null for a half-written file", () => {
    expect(readScene(`{"elements": [`, restore)).toBeNull();
  });
});
