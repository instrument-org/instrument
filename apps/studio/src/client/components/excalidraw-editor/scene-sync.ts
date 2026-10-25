// The save and merge layer under the Excalidraw canvas, the drawing
// counterpart of the Markdown editor's doc-sync and the code editor's
// text-sync.
//
// 1. A save writes back the untouched bytes of every element the person did
//    not change. The elements array of the disk text is rebuilt in the
//    canvas's order, an element whose canvas copy equals what the disk copy
//    restores to (ignoring the bookkeeping Excalidraw rewrites on every
//    touch) keeping its exact slice of the file, and only the changed and new
//    ones serialized. Everything outside `elements` keeps its bytes, except
//    that images new to the canvas are added to `files`.
// 2. A change on disk is a three-way merge: base = the elements the disk text
//    the canvas last synced with restores to, ours = the canvas, theirs = the
//    new disk text, restored. By element id, then by property: a property only
//    one side changed takes that side, and one both changed takes the
//    person's. An element the agent dropped (by omission or by tombstone) is
//    deleted unless the person changed it; one the agent added is added.
//    Excalidraw's own `reconcileElements` is not used: it is last writer wins
//    by `version`, which a script editing the JSON never bumps. The order of
//    the elements (which is in front) takes the agent's when only the agent
//    changed it.
// 3. The board's own settings in `appState` (background and grid) merge the
//    same way, key by key; the rest of `appState` is the view, which stays
//    the person's and is never written.
//
// Pure, with Excalidraw's `restoreElements` handed in, since the package
// cannot load outside a browser.
import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  type Node,
  parseTree,
} from "jsonc-parser";

export interface SceneElement {
  [key: string]: unknown;
  id: string;
  isDeleted?: boolean;
  version?: number;
  versionNonce?: number;
}

export interface SceneFile {
  [key: string]: unknown;
  id: string;
}

/** Fills in what a terse element leaves out, as Excalidraw's `restoreElements(x, null)` does. */
export type Restore = (raw: SceneElement[]) => readonly SceneElement[];

/**
 * A text an agent wrote with no size is dropped by `restoreElements` as
 * invisibly small; given a placeholder one, it is measured instead.
 */
export function sizedText(element: SceneElement): SceneElement {
  if (
    element.type !== "text" ||
    (typeof element.width === "number" && element.width > 0)
  ) {
    return element;
  }
  return { ...element, height: 1, width: 1 };
}

/** The keys of `appState` that are the board's, not the view's. */
const SETTINGS = [
  "viewBackgroundColor",
  "gridSize",
  "gridStep",
  "gridModeEnabled",
] as const;

export type SceneSettings = Partial<Record<(typeof SETTINGS)[number], unknown>>;

/** The board's settings out of an app state, the canvas's or the file's. */
export function settingsOf(appState: unknown): SceneSettings {
  if (!isRecord(appState)) {
    return {};
  }
  return Object.fromEntries(
    SETTINGS.flatMap((key) =>
      appState[key] === undefined ? [] : [[key, appState[key]]],
    ),
  );
}

/** The settings `next` has that differ from `previous`. */
export function changedSettings(
  previous: SceneSettings,
  next: SceneSettings,
): SceneSettings {
  return Object.fromEntries(
    SETTINGS.flatMap((key) =>
      next[key] !== undefined &&
      stableJson(next[key]) !== stableJson(previous[key])
        ? [[key, next[key]]]
        : [],
    ),
  );
}

/** A disk text read as a scene: its restored elements, its images and its settings. */
export interface DiskScene {
  elements: readonly SceneElement[];
  files: Record<string, SceneFile>;
  /** Ids of elements the file names itself; one without gets one here, and is written in full on the next save. */
  ownIds: ReadonlySet<string>;
  settings: SceneSettings;
  text: string;
}

/**
 * What Excalidraw changes on every touch of an element, and what restoring an
 * element that lacks it makes up at random. Never compared or merged.
 */
const BOOKKEEPING = new Set([
  "index",
  "seed",
  "updated",
  "version",
  "versionNonce",
]);

/**
 * Reads a disk text as a scene, or null when it is not a scene yet (an agent
 * halfway through a write, or a file that is not JSON). An empty file is an
 * empty scene.
 */
export function readScene(text: string, restore: Restore): DiskScene | null {
  if (text.trim() === "") {
    return { elements: [], files: {}, ownIds: new Set(), settings: {}, text };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(data)) {
    return null;
  }
  const rawElements: unknown[] = Array.isArray(data.elements)
    ? data.elements
    : [];
  const ownIds = new Set(
    rawElements.flatMap((raw) =>
      isRecord(raw) && typeof raw.id === "string" && raw.id !== ""
        ? [raw.id]
        : [],
    ),
  );
  const named = nameElements(rawElements).filter(
    (element): element is SceneElement => element !== null,
  );
  const files: Record<string, SceneFile> = {};
  if (isRecord(data.files)) {
    for (const [id, file] of Object.entries(data.files)) {
      if (isRecord(file)) {
        files[id] = { ...file, id };
      }
    }
  }
  return {
    elements: restore(named).filter((element) => !element.isDeleted),
    files,
    ownIds,
    settings: settingsOf(data.appState),
    text,
  };
}

export interface SceneMerge {
  /** Ids the agent's change reached, on the canvas. */
  changed: string[];
  /** Properties (or whole elements) both sides changed, where the person's edit was kept. */
  conflicts: number;
  elements: SceneElement[];
}

/**
 * Merges the agent's change into the canvas: `base` and `theirs` restored
 * from disk, `ours` the canvas as it stands, deleted elements included. An
 * element the agent's change leaves alone keeps its canvas object, so an edit
 * in progress on it is not disturbed; every element it reaches gets a version
 * above both sides', which is what makes the canvas redraw it.
 */
export function mergeScene({
  base,
  ours,
  theirs,
}: {
  base: readonly SceneElement[];
  ours: readonly SceneElement[];
  theirs: readonly SceneElement[];
}): SceneMerge {
  const baseById = byId(base);
  const theirsById = byId(theirs);
  const changed: string[] = [];
  let conflicts = 0;

  const reached = (
    element: SceneElement,
    ...sides: (SceneElement | undefined)[]
  ) => {
    const version = Math.max(
      ...[element, ...sides].map((side) => side?.version ?? 0),
    );
    changed.push(element.id);
    return {
      ...element,
      updated: Date.now(),
      version: version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
    };
  };

  const elements = ours.map((o): SceneElement => {
    const b = baseById.get(o.id);
    const t = theirsById.get(o.id);
    const present = !o.isDeleted;
    if (!b) {
      if (!t) {
        return o;
      }
      // Both sides added an element under one id: merged over nothing.
      if (!present) {
        return reached({ ...t }, o);
      }
      const merged = mergeProperties({}, o, t);
      conflicts += merged.conflicts;
      return merged.changed ? reached(merged.element, t) : o;
    }
    if (!present) {
      // The person deleted it; an edit of the agent's to it is lost.
      if (t && !sameElement(t, b)) {
        conflicts++;
      }
      return o;
    }
    if (!t) {
      if (sameElement(o, b)) {
        return reached({ ...o, isDeleted: true }, b);
      }
      // The agent dropped an element the person was changing: theirs stands.
      conflicts++;
      return o;
    }
    if (sameElement(t, b)) {
      return o;
    }
    const merged = mergeProperties(b, o, t);
    conflicts += merged.conflicts;
    return merged.changed ? reached(merged.element, b, t) : o;
  });

  // The agent's new elements, each placed after the element before it in
  // the agent's order.
  const oursIds = new Set(ours.map((element) => element.id));
  let previous: string | undefined;
  for (const t of theirs) {
    if (!oursIds.has(t.id) && !baseById.has(t.id)) {
      const after =
        previous === undefined
          ? -1
          : elements.findIndex((element) => element.id === previous);
      elements.splice(after + 1, 0, reached({ ...t }));
    }
    previous = t.id;
  }

  const ordered = inTheirOrder({ base, elements, ours, reached, theirs });
  return { changed: [...new Set(changed)], conflicts, elements: ordered };
}

/**
 * The merged elements in the agent's order, when the agent reordered the
 * elements both sides have and the person did not; otherwise as they are.
 * What the agent's file does not have (tombstones, the person's new
 * elements) stays after the element it followed. Every element that moved
 * is reached, so the canvas redraws it.
 */
function inTheirOrder({
  base,
  elements,
  ours,
  reached,
  theirs,
}: {
  base: readonly SceneElement[];
  elements: SceneElement[];
  ours: readonly SceneElement[];
  reached: (element: SceneElement) => SceneElement;
  theirs: readonly SceneElement[];
}) {
  const live = (list: readonly SceneElement[]) =>
    new Set(list.filter((e) => !e.isDeleted).map((e) => e.id));
  const ids = [live(base), live(ours), live(theirs)];
  const shared = (list: readonly SceneElement[]) =>
    list
      .filter((e) => !e.isDeleted && ids.every((set) => set.has(e.id)))
      .map((e) => e.id)
      .join("\n");
  const baseOrder = shared(base);
  if (shared(ours) !== baseOrder || shared(theirs) === baseOrder) {
    return elements;
  }
  const merged = new Map(elements.map((element) => [element.id, element]));
  const ordered = theirs.flatMap((t) => merged.get(t.id) ?? []);
  const placed = new Set(ordered.map((element) => element.id));
  let previous: string | undefined;
  for (const element of elements) {
    if (!placed.has(element.id)) {
      const after =
        previous === undefined
          ? -1
          : ordered.findIndex((candidate) => candidate.id === previous);
      ordered.splice(after + 1, 0, element);
      placed.add(element.id);
    }
    previous = element.id;
  }
  const before = elements.map((element) => element.id);
  return ordered.map((element, index) =>
    element.id === before[index] ? element : reached(element),
  );
}

/** The images on disk the canvas does not have yet. */
export function newFiles({
  ours,
  theirs,
}: {
  ours: Readonly<Record<string, unknown>>;
  theirs: Readonly<Record<string, SceneFile>>;
}): SceneFile[] {
  return Object.values(theirs).filter((file) => !(file.id in ours));
}

/**
 * The disk text with the canvas's elements and images written into it,
 * keeping the bytes of everything the person did not change; null when the
 * text has no scene to write into, for the caller to serialize whole.
 */
export function spliceScene({
  disk,
  elements,
  files,
  settings = {},
}: {
  disk: DiskScene;
  elements: readonly SceneElement[];
  files: Readonly<Record<string, SceneFile>>;
  /** Settings the person changed on the canvas, written into `appState`. */
  settings?: SceneSettings;
}): null | string {
  const root = disk.text.trim() === "" ? undefined : parseTree(disk.text);
  if (root?.type !== "object") {
    return null;
  }
  const elementsNode = findNodeAtLocation(root, ["elements"]);
  if (elementsNode?.type !== "array") {
    return null;
  }
  const unit = indentUnit(disk.text, root);
  const baseById = byId(disk.elements);
  const children = elementsNode.children ?? [];
  const named = nameElements(
    children.map((child): unknown => getNodeValue(child)),
  );
  const slices = new Map<string, string>();
  children.forEach((child, index) => {
    const id = named[index]?.id;
    if (id !== undefined) {
      slices.set(
        id,
        disk.text.slice(child.offset, child.offset + child.length),
      );
    }
  });

  // An element on disk the canvas has no record of, not even a deletion, is
  // one it could not draw (a text with no size, a type it does not know):
  // kept as it is, after the element it follows on disk.
  const onCanvas = new Set(elements.map((element) => element.id));
  const kept: SceneElement[] = elements.filter((element) => !element.isDeleted);
  let previous: string | undefined;
  for (const element of named) {
    if (element && !onCanvas.has(element.id)) {
      const after =
        previous === undefined
          ? -1
          : kept.findIndex((candidate) => candidate.id === previous);
      kept.splice(after + 1, 0, element);
    }
    if (element) {
      previous = element.id;
    }
  }

  const items = kept.map((element) => {
    if (!onCanvas.has(element.id)) {
      return { slice: slices.get(element.id) ?? "", untouched: true };
    }
    const b = baseById.get(element.id);
    const slice = slices.get(element.id);
    if (
      b &&
      slice !== undefined &&
      disk.ownIds.has(element.id) &&
      sameElement(element, b)
    ) {
      return { slice, untouched: true };
    }
    return {
      slice: JSON.stringify(element, null, unit).replaceAll(
        "\n",
        `\n${unit}${unit}`,
      ),
      untouched: false,
    };
  });

  const diskOrder = (elementsNode.children ?? []).map((child) =>
    disk.text.slice(child.offset, child.offset + child.length),
  );
  let text = disk.text;
  const unchanged =
    items.length === diskOrder.length &&
    items.every(
      (item, index) => item.untouched && item.slice === diskOrder[index],
    );
  if (!unchanged) {
    const array =
      items.length === 0
        ? "[]"
        : `[\n${items.map((item) => `${unit}${unit}${item.slice}`).join(",\n")}\n${unit}]`;
    text =
      text.slice(0, elementsNode.offset) +
      array +
      text.slice(elementsNode.offset + elementsNode.length);
  }

  // Images the canvas has that the file does not, for elements still on it.
  const used = new Set(
    kept.flatMap((element) =>
      typeof element.fileId === "string" ? [element.fileId] : [],
    ),
  );
  const added = Object.values(files).filter(
    (file) => used.has(file.id) && !(file.id in disk.files),
  );
  if (added.length > 0) {
    text = addFiles(text, added, unit);
  }
  for (const [key, value] of Object.entries(settings)) {
    text = applyEdits(
      text,
      modify(text, ["appState", key], value, {
        formattingOptions: {
          insertSpaces: !unit.includes("\t"),
          tabSize: unit.includes("\t") ? 1 : unit.length,
        },
      }),
    );
  }
  return text;
}

/** Whether two elements are the same drawing, apart from Excalidraw's bookkeeping. */
function sameElement(a: SceneElement, b: SceneElement) {
  return (
    stableJson(withoutBookkeeping(a)) === stableJson(withoutBookkeeping(b))
  );
}

function addFiles(text: string, added: SceneFile[], unit: string) {
  const root = parseTree(text);
  const filesNode = root && findNodeAtLocation(root, ["files"]);
  const entries = added.map(
    (file) =>
      `${unit}${unit}${JSON.stringify(file.id)}: ${JSON.stringify(file, null, unit).replaceAll("\n", `\n${unit}${unit}`)}`,
  );
  if (filesNode?.type === "object") {
    const end = filesNode.offset + filesNode.length - 1;
    const before = text.slice(0, end).trimEnd();
    const comma = (filesNode.children ?? []).length > 0 ? "," : "";
    return `${before}${comma}\n${entries.join(",\n")}\n${unit}${text.slice(end)}`;
  }
  // No `files` yet: added as the scene's last key.
  if (!root) {
    return text;
  }
  const end = root.offset + root.length - 1;
  const before = text.slice(0, end).trimEnd();
  return `${before},\n${unit}"files": {\n${entries.join(",\n")}\n${unit}}\n${text.slice(end)}`;
}

/**
 * The file's elements, each under its own id or, lacking one, an id drawn
 * from its content: restoring makes up a random id, which would read as a new
 * element on every merge, where this one is the same every time the same text
 * is read. Aligned with the array on disk, null where an entry is not an
 * element.
 */
function nameElements(raw: readonly unknown[]): (null | SceneElement)[] {
  const seen = new Set(
    raw.flatMap((element) =>
      isRecord(element) && typeof element.id === "string" ? [element.id] : [],
    ),
  );
  return raw.map((element) => {
    if (!isRecord(element)) {
      return null;
    }
    if (typeof element.id === "string" && element.id !== "") {
      return element as SceneElement;
    }
    const content = hash(stableJson(element));
    let id = `el-${content}`;
    for (let n = 2; seen.has(id); n++) {
      id = `el-${content}-${n}`;
    }
    seen.add(id);
    return { ...element, id };
  });
}

function byId(elements: readonly SceneElement[]) {
  return new Map(
    elements
      .filter((element) => !element.isDeleted)
      .map((element) => [element.id, element]),
  );
}

function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The file's indent: what the first key of the scene is indented by. */
function indentUnit(text: string, root: Node) {
  const first = root.children?.[0];
  if (!first) {
    return "  ";
  }
  const lineStart = text.lastIndexOf("\n", first.offset) + 1;
  const lead = text.slice(lineStart, first.offset);
  return /^[ \t]+$/.test(lead) ? lead : "  ";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merges one element property by property: what only one side changed comes
 * from that side, and what both changed differently stays the person's.
 */
function mergeProperties(
  b: Record<string, unknown>,
  o: SceneElement,
  t: SceneElement,
) {
  const element: SceneElement = { ...o };
  let conflicts = 0;
  let changed = false;
  const keys = new Set([
    ...Object.keys(b),
    ...Object.keys(o),
    ...Object.keys(t),
  ]);
  for (const key of keys) {
    if (BOOKKEEPING.has(key)) {
      continue;
    }
    const bv = stableJson(b[key]);
    const ov = stableJson(o[key]);
    const tv = stableJson(t[key]);
    if (tv === bv || tv === ov) {
      continue;
    }
    if (ov === bv) {
      if (t[key] === undefined) {
        delete element[key];
      } else {
        element[key] = t[key];
      }
      changed = true;
    } else {
      conflicts++;
    }
  }
  return { changed, conflicts, element };
}

/** JSON with object keys sorted, so equal values compare equal. */
function stableJson(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  return JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(
          Object.keys(inner)
            .sort()
            .map((key) => [key, inner[key]]),
        )
      : inner,
  );
}

function withoutBookkeeping(element: SceneElement) {
  return Object.fromEntries(
    Object.entries(element).filter(
      ([key, value]) => !BOOKKEEPING.has(key) && value !== undefined,
    ),
  );
}
