import {
  type AskMark,
  stepAskMarks,
} from "@/client/components/orchestrator/ask-marks";
// One Markdown file open in the Milkdown editor: the editor itself, and the
// disk I/O around it. Saves are debounced and flushed on demand; a write that
// finds the file changed underneath it merges the disk text and tries again;
// a change on disk (the agent writing the file) merges into the editor as the
// minimal edits it made and flashes the blocks it touched. All disk I/O runs
// through one queue, so a merge never interleaves with a save in flight.
import {
  AGENT_FLASH_MS,
  createSaveQueue,
  flushOnLeave,
  type SaveStatus,
} from "@/client/lib/live-file";
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
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
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
  mapPos,
} from "./doc-sync";
import { splitFrontMatter } from "./front-matter";
import { createHtmlView, htmlStructurePlugin } from "./html-render";
import { icon, instrumentMark } from "./icons";
import { fitSelectionToolbar } from "./toolbar-fit";

export interface AskSelection {
  /** The kind of block the selection starts in, as a reader names it: "Heading", "Paragraph". */
  block?: string;
  from: number;
  lines?: [number, number];
  quote: string;
  /** Where the selection stands on screen as it was asked about. */
  rect: DOMRect;
  to: number;
}

export type EditorSession = Awaited<ReturnType<typeof createEditorSession>>;

export interface EditorSessionOptions {
  hostPath: string;
  initial: { content: string; version: string };
  /** Asks about the selection: its words, where they are, and a box to stand the ask card by. */
  onAsk: (selection: AskSelection) => void;
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

const flashKey = new PluginKey<FlashRange[] | null>("agent-flash");
const askMarkKey = new PluginKey<AskMark[]>("ask-marks");

/** What a top-level block is called where an ask names its place. */
const BLOCK_NAMES: Record<string, string> = {
  blockquote: "Quote",
  bullet_list: "List",
  code_block: "Code block",
  heading: "Heading",
  html: "HTML",
  image: "Image",
  ordered_list: "List",
  paragraph: "Paragraph",
  table: "Table",
};

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

const ASK_ICON = `<span class="md-ask">${instrumentMark(14)}<span>Ask</span></span>`;

interface MdImage {
  title?: null | string;
  type: string;
}
interface MdParent {
  children?: (MdImage & MdParent)[];
}

/** Gives every image under `n` a string title where it has none. */
function fillImageTitles(n: MdImage & MdParent) {
  if (n.type === "image" && (n.title === null || n.title === undefined)) {
    n.title = "";
  }
  for (const child of n.children ?? []) {
    fillImageTitles(child);
  }
}
const imageTitlePlugin = () => fillImageTitles;

/** Commonmark's image node requires a string title; remark gives null when there is none, and the parser throws. */
const imageTitleFix = $remark("imageTitleFix", () => imageTitlePlugin);

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

  const saves = createSaveQueue({
    label: "markdown editor",
    onStatus: options.onStatus,
    save,
  });
  const scheduleSave = saves.schedule;

  async function save() {
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

  /** The file changed on disk (or may have): read it and merge what changed. */
  const pull = () => {
    if (destroyed) {
      return;
    }
    saves.pull(async () => {
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
  // Set once the editor is up.
  let onDocChange: (() => void) | null = null;

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
              from: mapPos(tr.mapping, r.from, -1),
              to: mapPos(tr.mapping, r.to, 1),
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
              }, AGENT_FLASH_MS);
            }
            if (v.state.doc !== prev.doc && !applyingExternal && disk) {
              scheduleSave();
            }
            if (v.state.doc !== prev.doc) {
              onDocChange?.();
            }
          },
        }),
      }),
  );

  /** An image in the file: its own picture, resolved against the file's folder. */
  const renderImage: NodeViewConstructor = (node) => {
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
  };
  const imageView = $view(imageSchema.node, () => renderImage);

  /**
   * Raw HTML, rendered as Studio's viewer renders it: sanitized to GitHub's
   * allow-list, so no script, style, iframe or handler in the file ever runs
   * here. Clicking a rendered node edits its source in a popover. The node
   * keeps the source verbatim, so an untouched block saves byte-identical.
   */
  const renderHtml: NodeViewConstructor = (node, pmView, getPos, decorations) =>
    createHtmlView({
      decorations,
      getPos,
      node,
      resolveSrc: options.resolveSrc,
      view: pmView,
    });
  const htmlView = $view(htmlSchema.node, () => renderHtml);
  const htmlContainerPlugin = $prose(() => htmlStructurePlugin());

  /**
   * The places staged asks point at, tinted, each with its number at its
   * end. Kept as positions and mapped through every edit, the person's and
   * the agent's alike, so a marker stays on its words.
   */
  const askMarksPlugin = $prose(
    () =>
      new Plugin<AskMark[]>({
        key: askMarkKey,
        props: {
          decorations(state) {
            const marks = askMarkKey.getState(state) ?? [];
            if (marks.length === 0) {
              return null;
            }
            const size = state.doc.content.size;
            return DecorationSet.create(
              state.doc,
              marks.flatMap((mark) => {
                // Numbered once the window has it among its asks.
                if (mark.n === 0) {
                  return [];
                }
                const from = Math.min(mark.from, size);
                const to = Math.min(mark.to, size);
                return [
                  ...(to > from
                    ? [Decoration.inline(from, to, { class: "md-ask-mark" })]
                    : []),
                  Decoration.widget(to, () => askBadge(mark.n), {
                    ignoreSelection: true,
                    key: `ask-${mark.id}-${mark.n}`,
                    side: 1,
                  }),
                ];
              }),
            );
          },
        },
        state: {
          apply(tr, marks) {
            // What `addAskMark` and `setAskNumbers` below dispatch.
            const meta = tr.getMeta(askMarkKey) as
              | undefined
              | { add?: AskMark; numbers?: { id: string; n: number }[] };
            return stepAskMarks(marks, {
              ...meta,
              ...(tr.docChanged
                ? {
                    map: (pos: number, assoc: -1 | 1) =>
                      mapPos(tr.mapping, pos, assoc),
                  }
                : {}),
            });
          },
          init: () => [],
        },
      }),
  );

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
    const { $from, from, to } = v.state.selection;
    if (from === to || !disk) {
      return;
    }
    flushDomObserver(v);
    // The toolbar re-reads only on a change to the selection or the document,
    // never on focus moving to the ask card, so it is put away here; the next
    // selection brings it back.
    const toolbar = root.querySelector<HTMLElement>(".milkdown-toolbar");
    if (toolbar) {
      toolbar.dataset.show = "false";
    }
    const quote = v.state.doc.textBetween(from, to, "\n", " ");
    const lines = sync.sourceLines(v.state.doc, disk, from, to, quote);
    const start = v.coordsAtPos(from);
    const end = v.coordsAtPos(to);
    const left = Math.min(start.left, end.left);
    const block =
      $from.depth > 0 ? BLOCK_NAMES[$from.node(1).type.name] : undefined;
    options.onAsk({
      ...(block ? { block } : {}),
      from,
      quote,
      rect: new DOMRect(
        left,
        start.top,
        Math.max(start.right, end.right) - left,
        end.bottom - start.top,
      ),
      to,
      ...(lines ? { lines } : {}),
    });
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
            label: "Ask",
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
    .use(nearCaretPlugin)
    .use(askMarksPlugin);
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

  const stopFlushOnLeave = flushOnLeave(saves.flush, root);
  const stopFittingToolbar = fitSelectionToolbar(root, () => {
    const { from, to } = pmView.state.selection;
    return {
      bottom: pmView.coordsAtPos(to).bottom,
      top: pmView.coordsAtPos(from).top,
    };
  });

  const handle = {
    /**
     * Marks a staged ask's place, numbered once `setAskNumbers` names it; a
     * place whose words no longer read as they did is not marked.
     */
    addAskMark: (id: string, from: number, to: number, quote?: string) => {
      const v = view();
      const size = v.state.doc.content.size;
      if (
        to > size ||
        (quote !== undefined &&
          v.state.doc.textBetween(from, to, "\n", " ") !== quote)
      ) {
        return;
      }
      v.dispatch(
        v.state.tr.setMeta(askMarkKey, {
          add: { from, id, n: 0, to },
        }),
      );
    },
    /** Where each staged ask's mark stands now, for putting them back on a later mount. */
    askMarks: () =>
      (askMarkKey.getState(view().state) ?? []).map(({ from, id, to }) => ({
        from,
        id,
        to,
      })),
    currentText,
    /** Saves what is unsaved, then tears the editor down. */
    destroy: async () => {
      if (destroyed) {
        return;
      }
      stopFlushOnLeave();
      await saves.flush();
      destroyed = true;
      clearTimeout(flashTimer);
      saves.cancel();
      code.destroy();
      removeBlockMenu();
      stopFittingToolbar();
      await crepe?.destroy();
      crepe = null;
    },
    disk: () => disk,
    flush: saves.flush,
    frontMatter: currentFrontMatter,
    /** Whether nothing is waiting to be written. */
    idle: async () =>
      (await saves.idle()) && disk !== null && currentText() === disk.text,
    lastSplice: sync.lastSplice,
    pull,
    /** Scrolls a staged ask's place into view and selects it. */
    revealAskMark: (id: string) => {
      const v = view();
      const mark = askMarkKey
        .getState(v.state)
        ?.find((entry) => entry.id === id);
      if (!mark) {
        return;
      }
      const size = v.state.doc.content.size;
      v.dispatch(
        v.state.tr
          .setSelection(
            TextSelection.create(
              v.state.doc,
              Math.min(mark.from, size),
              Math.min(mark.to, size),
            ),
          )
          .scrollIntoView(),
      );
    },
    /** The staged asks this document holds, numbered; a mark whose ask is gone goes too. */
    setAskNumbers: (numbers: { id: string; n: number }[]) => {
      const v = view();
      v.dispatch(v.state.tr.setMeta(askMarkKey, { numbers }));
    },
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

/** A staged ask's number, as the badge at the end of its place. */
function askBadge(n: number) {
  const badge = document.createElement("span");
  badge.className = "md-ask-badge";
  badge.contentEditable = "false";
  badge.textContent = String(n);
  return badge;
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
