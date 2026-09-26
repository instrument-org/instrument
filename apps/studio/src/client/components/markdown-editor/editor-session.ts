// One Markdown file open in the Milkdown editor: the editor itself, and the
// disk I/O around it. Saves are debounced and flushed on demand; a write that
// finds the file changed underneath it merges the disk text and tries again;
// a change on disk (the agent writing the file) merges into the editor as the
// minimal edits it made and flashes the blocks it touched. All disk I/O runs
// through one queue, so a merge never interleaves with a save in flight.
import { rpcClient } from "@/client/rpc/client";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { Crepe } from "@milkdown/crepe";
import {
  editorViewCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import { htmlSchema, imageSchema } from "@milkdown/kit/preset/commonmark";
import { type Node as PMNode } from "@milkdown/kit/prose/model";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeViewConstructor,
} from "@milkdown/kit/prose/view";
import { $prose, $remark, $view } from "@milkdown/kit/utils";

import { installBlockMenu } from "./block-menu";
import {
  codeBlockInfo,
  decorateCodeBlocks,
  languages,
  renderPreview,
} from "./code-blocks";
import {
  childrenOf,
  createDocSync,
  type DiskState,
  type FlashRange,
  flushDomObserver,
  splitFrontMatter,
} from "./doc-sync";
import { createHtmlView, htmlStructurePlugin } from "./html-render";
import { icon, mark } from "./icons";

export type EditorSession = Awaited<ReturnType<typeof createEditorSession>>;

export interface EditorSessionOptions {
  hostPath: string;
  initial: { content: string; version: string };
  onAsk: (selection: { lines?: [number, number]; quote: string }) => void;
  onExternalChange: (change: ExternalChange) => void;
  onFrontMatter: (fm: string) => void;
  onStatus: (status: SaveStatus, detail?: string) => void;
  /** Draws a fence Studio shows as something other than code; the element is filled in by the caller. */
  renderFence: (language: string, content: string) => null | string;
  resolveSrc: (src: string) => string;
  root: HTMLElement;
}

export interface ExternalChange {
  /** The top-level block the change touched first, as drawn. */
  element: HTMLElement | null;
  /** Whether the person's version of a block was kept over the agent's. */
  keptYours: boolean;
  result: string;
}

export type SaveStatus = "error" | "saved" | "saving" | "unsaved";

/** How long typing rests before a save, and the longest a save waits under steady typing. */
const SAVE_DEBOUNCE_MS = 400;
const SAVE_MAX_WAIT_MS = 2000;
const FLASH_MS = 1800;

const flashKey = new PluginKey<FlashRange[] | null>("agent-flash");

// Token colors come from CSS variables, so code blocks follow the theme.
const codeColors = syntaxHighlighting(
  HighlightStyle.define([
    {
      color: "var(--hl-keyword)",
      tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword],
    },
    {
      color: "var(--hl-string)",
      tag: [t.string, t.special(t.string), t.regexp],
    },
    { color: "var(--hl-number)", tag: [t.number, t.bool, t.null, t.atom] },
    {
      color: "var(--hl-comment)",
      fontStyle: "italic",
      tag: [t.comment, t.lineComment, t.blockComment],
    },
    {
      color: "var(--hl-function)",
      tag: [t.function(t.variableName), t.function(t.propertyName)],
    },
    { color: "var(--hl-type)", tag: [t.typeName, t.className, t.namespace] },
    { color: "var(--hl-tag)", tag: [t.tagName, t.angleBracket] },
    { color: "var(--hl-attr)", tag: [t.attributeName, t.propertyName] },
    {
      color: "var(--hl-variable)",
      tag: [t.variableName, t.definition(t.variableName)],
    },
    { color: "var(--hl-punct)", tag: [t.punctuation, t.operator] },
    { color: "var(--hl-keyword)", fontWeight: "bold", tag: t.heading },
    { color: "var(--hl-string)", tag: t.link, textDecoration: "underline" },
  ]),
);

const ASK_ICON = `<span class="md-ask">${mark(14)}<span>Ask Instrument</span></span>`;

interface MdImage {
  title?: null | string;
  type: string;
}
interface MdParent {
  children?: (MdImage & MdParent)[];
}

/** Commonmark's image node requires a string title; remark gives null when there is none, and the parser throws. */
const imageTitleFix = $remark("imageTitleFix", () => () => (tree) => {
  const walk = (n: MdImage & MdParent) => {
    if (n.type === "image" && (n.title === null || n.title === undefined)) {
      n.title = "";
    }
    n.children?.forEach(walk);
  };
  walk(tree);
});

export async function createEditorSession(options: EditorSessionOptions) {
  const { hostPath, initial, root } = options;
  let crepe: Crepe | null = null;
  let viewRef: EditorView | null = null;
  const view = () => {
    if (!viewRef) {
      throw new Error("the editor is not up");
    }
    return viewRef;
  };
  let parser: ((md: string) => PMNode) | null = null;
  let serializer: ((doc: PMNode) => string) | null = null;
  const sync = createDocSync({
    parse: (md) => {
      if (!parser) {
        throw new Error("the editor is not up");
      }
      return parser(md);
    },
    serialize: (doc) => {
      if (!serializer) {
        throw new Error("the editor is not up");
      }
      return serializer(doc);
    },
    view,
  });

  let disk: DiskState | null = null;
  // Every write that landed, with the text it replaced, for the invariant
  // check to read back in development.
  const writeLog: { base: string; content: string }[] = [];
  // Front matter edited in the card, until it is saved.
  let fmLocal: null | string = null;
  let destroyed = false;
  let applyingExternal = false;

  const currentFrontMatter = () => fmLocal ?? disk?.fm ?? "";
  const currentText = () => {
    if (!disk) {
      return initial.content;
    }
    return currentFrontMatter() + sync.splicedBody(view().state.doc, disk);
  };

  // ---------------------------------------------------------------- disk queue

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>) => {
    queue = queue.then(task).catch((error: unknown) => {
      console.error("markdown editor:", error);
      options.onStatus(
        "error",
        error instanceof Error ? error.message : "Could not save",
      );
    });
    return queue;
  };

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueued = false;
  let pendingSince = 0;
  // Debounced, but never postponed past the max wait: a steady stream of
  // keystrokes or agent writes must not keep the person's edits off disk.
  const scheduleSave = (ms = SAVE_DEBOUNCE_MS) => {
    clearTimeout(saveTimer);
    pendingSince ||= Date.now();
    options.onStatus("unsaved");
    saveTimer = setTimeout(
      () => {
        saveTimer = undefined;
        pendingSince = 0;
        if (saveQueued) {
          return;
        }
        saveQueued = true;
        void enqueue(save);
      },
      Math.max(0, Math.min(ms, pendingSince + SAVE_MAX_WAIT_MS - Date.now())),
    );
  };

  const flush = () => {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      pendingSince = 0;
      if (!saveQueued) {
        saveQueued = true;
        void enqueue(save);
      }
    }
    return queue;
  };

  async function save() {
    saveQueued = false;
    if (!disk) {
      return;
    }
    flushDomObserver(view());
    const text = currentText();
    if (text === disk.text) {
      if (fmLocal === disk.fm) {
        fmLocal = null;
      }
      options.onStatus("saved");
      return;
    }
    options.onStatus("saving");
    const base = disk;
    const r = await rpcClient.files.write.call({
      baseVersion: base.version,
      content: text,
      path: hostPath,
    });
    if (r.ok) {
      if (import.meta.env.DEV) {
        writeLog.push({ base: base.text, content: text });
      }
      disk = sync.diskAfterSave(base, text, r.version);
      if (fmLocal === disk.fm) {
        fmLocal = null;
      }
      options.onStatus("saved");
      // Typed while the write was in flight.
      if (!destroyed && currentText() !== disk.text) {
        scheduleSave();
      }
      return;
    }
    // The file changed after our last sync. Merge it under our edits, then
    // save again against the new version.
    mergeIn(r.content, r.version);
    scheduleSave(100);
  }

  let pullQueued = false;
  /** The file changed on disk (or may have): read it and merge what changed. */
  const pull = () => {
    if (pullQueued || destroyed) {
      return;
    }
    pullQueued = true;
    void enqueue(async () => {
      pullQueued = false;
      if (!disk) {
        return;
      }
      const r = await rpcClient.files.read.call({ path: hostPath });
      // Our own save's echo: the version we already hold.
      if (r.version === disk.version || r.content === disk.text) {
        return;
      }
      mergeIn(r.content, r.version);
    });
  };

  function mergeIn(content: string, version: string) {
    if (!disk) {
      return;
    }
    const before = disk;
    let merged: ReturnType<typeof sync.merge>;
    applyingExternal = true;
    try {
      merged = sync.merge(before, content, version, (tr, flashes) => {
        tr.setMeta(flashKey, flashes);
      });
    } catch (error) {
      options.onStatus(
        "error",
        `Could not read the new file (${error instanceof Error ? error.message : "unknown"})`,
      );
      return;
    } finally {
      applyingExternal = false;
    }
    const { conflicts, flashes, next } = merged;
    let { result } = merged;
    // Front matter: take theirs unless the person has an unsaved card edit.
    const fmChanged = next.fm !== before.fm;
    let keptYours = conflicts > 0;
    if (fmLocal === before.fm || fmLocal === next.fm) {
      fmLocal = null;
    } else if (fmLocal !== null && fmChanged) {
      keptYours = true;
      result +=
        "; the agent also changed the properties you are editing, so yours were kept";
    }
    disk = next;
    if (fmChanged && fmLocal === null) {
      options.onFrontMatter(next.fm);
    }
    const firstFlash = flashes[0];
    let element: HTMLElement | null = null;
    if (firstFlash) {
      const v = view();
      const $pos = v.state.doc.resolve(
        Math.min(firstFlash.from, v.state.doc.content.size),
      );
      const top = $pos.depth > 0 ? $pos.before(1) : firstFlash.from;
      const dom = v.nodeDOM(top);
      element = dom instanceof HTMLElement ? dom : null;
    }
    options.onExternalChange({
      element: element ?? (fmChanged ? root : null),
      keptYours,
      result,
    });
    if (currentText() !== disk.text) {
      scheduleSave();
    }
  }

  // ---------------------------------------------------------------- plugins

  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  let onDocChange = () => {
    // Replaced once the editor is up.
  };

  /** Reports local doc changes (for autosave) and flashes blocks an external change touched. */
  const sessionPlugin = $prose(
    () =>
      new Plugin<FlashRange[] | null>({
        key: flashKey,
        props: {
          decorations(state) {
            const ranges = flashKey.getState(state);
            if (!ranges?.length) {
              return null;
            }
            const decos: Decoration[] = [];
            for (const { node, offset: pos } of childrenOf(state.doc)) {
              if (
                ranges.some(
                  (r) =>
                    pos + node.nodeSize > r.from &&
                    pos <= Math.max(r.from, r.to),
                )
              ) {
                decos.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "agent-flash",
                  }),
                );
              }
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
        // Flashed ranges are kept as positions and decorated on demand: node
        // decorations mapped through setNodeMarkup (heading ids) get dropped.
        state: {
          apply(tr, ranges) {
            if (tr.getMeta("flash-clear")) {
              return null;
            }
            const f = tr.getMeta(flashKey) as FlashRange[] | undefined;
            if (f) {
              return f;
            }
            if (!ranges || !tr.docChanged) {
              return ranges;
            }
            return ranges.map((r) => ({
              from: tr.mapping.map(r.from, -1),
              to: tr.mapping.map(r.to, 1),
            }));
          },
          init: () => null,
        },
        view: () => ({
          update(v, prev) {
            const ranges = flashKey.getState(v.state);
            if (ranges && ranges !== flashKey.getState(prev)) {
              clearTimeout(flashTimer);
              flashTimer = setTimeout(() => {
                if (destroyed) {
                  return;
                }
                // See mergeIn: pending keystrokes first.
                flushDomObserver(v);
                v.dispatch(v.state.tr.setMeta("flash-clear", true));
              }, FLASH_MS);
            }
            if (v.state.doc !== prev.doc && !applyingExternal && disk) {
              scheduleSave();
            }
            if (v.state.doc !== prev.doc) {
              onDocChange();
            }
          },
        }),
      }),
  );

  /** An image in the file: its own picture, resolved against the file's folder. */
  const imageView = $view(imageSchema.node, () => (node) => {
    const img = document.createElement("img");
    img.className = "md-image";
    const render = (n: PMNode) => {
      const src = options.resolveSrc(String(n.attrs.src ?? ""));
      if (img.getAttribute("src") !== src) {
        img.src = src;
      }
      img.alt = String(n.attrs.alt ?? "");
      img.title = String(n.attrs.title ?? "");
    };
    render(node);
    return {
      dom: img,
      ignoreMutation: () => true,
      update(n) {
        if (n.type !== node.type) {
          return false;
        }
        render(n);
        return true;
      },
    };
  });

  /**
   * Raw HTML, rendered as Studio's viewer renders it: sanitized to GitHub's
   * allow-list, so no script, style, iframe or handler in the file ever runs
   * here. Clicking a rendered node edits its source in a popover. The node
   * keeps the source verbatim, so an untouched block saves byte-identical.
   */
  const htmlView = $view(
    htmlSchema.node,
    () => (node, pmView, getPos, decorations) =>
      createHtmlView({
        decorations,
        getPos,
        node,
        resolveSrc: options.resolveSrc,
        view: pmView,
      }),
  );
  const htmlContainerPlugin = $prose(() => htmlStructurePlugin());

  /** Marks the top-level blocks around the caret, which the stylesheet always lays out. */
  const nearCaretPlugin = $prose(
    () =>
      new Plugin({
        props: {
          decorations(state) {
            const { doc, selection } = state;
            const $head = selection.$head;
            if ($head.depth === 0) {
              return null;
            }
            // The caret's block and one on either side, found from the
            // caret rather than by walking a document of thousands of blocks.
            const index = $head.index(0);
            const at = $head.before(1);
            const current = doc.child(index);
            const decos = [
              Decoration.node(at, at + current.nodeSize, {
                class: "md-near-caret",
              }),
            ];
            if (index > 0) {
              const before = doc.child(index - 1);
              decos.push(
                Decoration.node(at - before.nodeSize, at, {
                  class: "md-near-caret",
                }),
              );
            }
            if (index + 1 < doc.childCount) {
              const after = doc.child(index + 1);
              const from = at + current.nodeSize;
              decos.push(
                Decoration.node(from, from + after.nodeSize, {
                  class: "md-near-caret",
                }),
              );
            }
            return DecorationSet.create(doc, decos);
          },
        },
      }),
  );

  // ---------------------------------------------------------------- boot

  const ask = () => {
    const v = view();
    const { from, to } = v.state.selection;
    if (from === to || !disk) {
      return;
    }
    flushDomObserver(v);
    const quote = v.state.doc.textBetween(from, to, "\n", " ");
    const lines = sync.sourceLines(v.state.doc, disk, from, to, quote);
    options.onAsk({ quote, ...(lines ? { lines } : {}) });
  };

  // Crepe's image block is lossy by design (it stores the alt text as a size
  // ratio), so the plain commonmark image, with the view above, is used.
  const editor = new Crepe({
    defaultValue: splitFrontMatter(initial.content).body,
    featureConfigs: {
      [Crepe.Feature.BlockEdit]: {
        advancedGroup: {
          codeBlock: { icon: icon("code", 16) },
          image: { icon: icon("image", 16) },
          math: { icon: icon("sigma", 16) },
          table: { icon: icon("table", 16) },
        },
        handleAddIcon: icon("plus", 14),
        handleDragIcon: icon("dotsSixVertical", 14),
        listGroup: {
          bulletList: { icon: icon("listBullets", 16) },
          orderedList: { icon: icon("listNumbers", 16) },
          taskList: { icon: icon("listChecks", 16) },
        },
        textGroup: {
          divider: { icon: icon("minus", 16) },
          h1: { icon: icon("textHOne", 16) },
          h2: { icon: icon("textHTwo", 16) },
          h3: { icon: icon("textHThree", 16) },
          h4: { icon: icon("textHFour", 16) },
          h5: { icon: icon("textHFive", 16) },
          h6: { icon: icon("textHSix", 16) },
          quote: { icon: icon("quotes", 16) },
          text: { icon: icon("textT", 16) },
        },
      },
      [Crepe.Feature.CodeMirror]: {
        clearSearchIcon: icon("x", 12),
        copyIcon: icon("copy", 12),
        expandIcon: icon("caretDown", 10),
        languages,
        searchIcon: icon("magnifyingGlass", 14),
        // Diagrams, messages and math read as what they draw; "Edit" shows the source.
        previewLabel: "Preview",
        previewOnlyByDefault: true,
        previewToggleIcon: (previewOnly) =>
          icon(previewOnly ? "pencilSimple" : "check", 12),
        previewToggleText: (previewOnly) => (previewOnly ? "Edit" : "Done"),
        renderPreview: renderPreview(options.renderFence),
        theme: codeColors,
      },
      [Crepe.Feature.LinkTooltip]: {
        confirmButton: icon("check", 14),
        editButton: icon("pencilSimple", 14),
        linkIcon: icon("link", 14),
        removeButton: icon("linkBreak", 14),
      },
      [Crepe.Feature.Placeholder]: { mode: "block", text: "Type / for blocks" },
      [Crepe.Feature.Table]: {
        addColIcon: icon("plus", 12),
        addRowIcon: icon("plus", 12),
        alignCenterIcon: icon("textAlignCenter", 14),
        alignLeftIcon: icon("textAlignLeft", 14),
        alignRightIcon: icon("textAlignRight", 14),
        colDragHandleIcon: icon("dotsSix", 14),
        deleteColIcon: icon("trash", 14),
        deleteRowIcon: icon("trash", 14),
        rowDragHandleIcon: icon("dotsSixVertical", 14),
      },
      [Crepe.Feature.Toolbar]: {
        boldIcon: icon("textB", 16),
        buildToolbar: (builder) => {
          builder.addGroup("ask", "Ask").addItem("ask", {
            active: () => false,
            icon: ASK_ICON,
            label: "Ask Instrument",
            onRun: ask,
          });
        },
        codeIcon: icon("code", 16),
        italicIcon: icon("textItalic", 16),
        latexIcon: icon("sigma", 16),
        linkIcon: icon("link", 16),
        strikethroughIcon: icon("textStrikethrough", 16),
      },
    },
    features: {
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.TopBar]: false,
    },
    root,
  });
  crepe = editor;
  // Studio treats only `$$`, ```math and the like as math; `$42,000` is money.
  editor.editor.config((ctx) => {
    ctx.set("remarkMath", { singleDollarTextMath: false });
  });
  // Serialized lists and rules use `-`, the marker most Markdown in the wild (and the agent) writes.
  editor.editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (prev) => ({
      ...prev,
      bullet: "-" as const,
      rule: "-" as const,
    }));
  });
  editor.editor
    .use(imageTitleFix)
    .use(codeBlockInfo)
    .use(sessionPlugin)
    .use(imageView)
    .use(htmlView)
    .use(htmlContainerPlugin)
    .use(nearCaretPlugin);
  await editor.create();
  editor.editor.action((ctx) => {
    viewRef = ctx.get(editorViewCtx);
    parser = ctx.get(parserCtx);
    serializer = ctx.get(serializerCtx);
  });
  const pmView = view();
  guardListItemRestore(pmView);
  const code = decorateCodeBlocks(pmView, root);
  const removeBlockMenu = installBlockMenu(pmView, root, {
    serializeNode: (node) =>
      serializer
        ? serializer(pmView.state.schema.topNodeType.create(null, [node]))
        : "",
  });
  onDocChange = code.schedule;
  code.schedule();
  disk = sync.loadDisk(initial.content, initial.version);
  options.onFrontMatter(disk.fm);
  options.onStatus("saved");

  // Leaving the editor is a save: the caret going elsewhere, the window
  // hiding, the window closing.
  const onFocusOut = (e: FocusEvent) => {
    if (!(e.relatedTarget instanceof Node) || !root.contains(e.relatedTarget)) {
      void flush();
    }
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") {
      void flush();
    }
  };
  const onUnload = () => {
    void flush();
  };
  root.addEventListener("focusout", onFocusOut);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("beforeunload", onUnload);

  const handle = {
    currentText,
    /** Saves what is unsaved, then tears the editor down. */
    destroy: async () => {
      if (destroyed) {
        return;
      }
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onUnload);
      await flush();
      destroyed = true;
      clearTimeout(flashTimer);
      clearTimeout(saveTimer);
      code.destroy();
      removeBlockMenu();
      await crepe?.destroy();
      crepe = null;
    },
    disk: () => disk,
    flush,
    frontMatter: currentFrontMatter,
    /** Whether nothing is waiting to be written. */
    idle: async () => {
      await queue;
      return (
        !saveQueued &&
        saveTimer === undefined &&
        disk !== null &&
        currentText() === disk.text
      );
    },
    lastSplice: sync.lastSplice,
    pull,
    /** Replaces the front matter with the card's edit; saved like typing. */
    setFrontMatter: (next: string) => {
      fmLocal = next;
      scheduleSave();
    },
    view,
    writeLog,
  };
  return handle;
}

/**
 * Crepe's list item view (bullets, task checkboxes) reads the selection when
 * it mounts and dispatches that same selection one animation frame later, to
 * re-sync the DOM selection after it moves its content. Whatever happened in
 * that frame is undone: a character typed then lands before the space typed
 * just ahead of it, and a caret placed elsewhere jumps back. List items mount
 * whenever a merged agent edit or its flash redraws a list, so this struck
 * while the person typed. The wrapper lets that restore through only while
 * nothing has moved since the mount; otherwise it re-applies the current
 * selection, which re-syncs the DOM just the same.
 */
function guardListItemRestore(pmView: EditorView) {
  const make = pmView.props.nodeViews?.list_item;
  if (!make) {
    return;
  }
  const listItem: NodeViewConstructor = (node, v, ...rest) => {
    const mountDoc = v.state.doc;
    const mountSel = v.state.selection;
    let fresh = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        fresh = false;
      }),
    );
    const dispatch = (tr: ReturnType<EditorView["state"]["tr"]["setMeta"]>) => {
      if (
        fresh &&
        !tr.docChanged &&
        tr.selectionSet &&
        (v.state.doc !== mountDoc || !v.state.selection.eq(mountSel))
      ) {
        fresh = false;
        v.dispatch(v.state.tr.setSelection(v.state.selection));
        return;
      }
      v.dispatch(tr);
    };
    const proxy = new Proxy(v, {
      get: (target, key) => {
        if (key === "dispatch") {
          return dispatch;
        }
        const value: unknown = Reflect.get(target, key);
        // A method of the view, called with the view as `this`.
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
    return make(node, proxy, ...rest);
  };
  pmView.setProps({
    nodeViews: { ...pmView.props.nodeViews, list_item: listItem },
  });
}
