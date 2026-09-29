/**
 * Edit in place: one Edit mode over the page, like a design tool. Click
 * selects an element and a floating toolbar offers what can be done to it:
 * edit its text, style it (Tailwind classes bound to the page's theme
 * tokens), replace an image, move, duplicate or delete it, or ask the agent.
 * Script-made and data-backed elements offer only the ask, with the reason.
 * Every direct edit is a minimal splice of the file on disk, kept on an undo
 * stack; the agent's own edits reload the page in place.
 *
 * Runs in the guest's isolated world, over the page itself: its UI lives in
 * a closed shadow root on the page, it acts only on the person's own input
 * (never on events a page script dispatches), and it talks to the window
 * through the preload's bridge (saves, asks, reloads), never to the disk or
 * the page's scripts. This file builds the editor from its parts, answers the
 * window, and boots it with what the previous load handed over.
 */
import {
  type PageEditorGuestMessage,
  type PageEditorHostMessage,
  type PageEditorSaveResult,
} from "@/shared/page-editor-messages";

import { type PageEditorBridge } from "../bridge";
import { createAsks } from "./asks";
import { classify, measure, textBlockFor } from "./classify";
import {
  type DocHandle,
  type Editor,
  type EditorSnapshot,
  type EditorState,
  type Ui,
} from "./context";
import { find, findAs } from "./dom";
import { loadFonts } from "./fonts";
import { createHistory } from "./history";
import { createImage } from "./image";
import { createInput } from "./input";
import { createLive } from "./live";
import { type PageWatch, pageWatch } from "./observer";
import { createOverlay } from "./overlay";
import { createReload } from "./reload";
import { createSelection } from "./selection";
import { analyze } from "./source";
import { createStructure } from "./structure-ops";
import { createStyle } from "./style";
import CSS from "./style.css?inline";
import { createTextEdit } from "./text-edit";
import { readTheme, resolveColors } from "./tokens";
import { createToolbar } from "./toolbar";
import { UI_HTML } from "./ui-html";

declare global {
  interface Window {
    /** Hooks for scripted checks, reachable from this world only. */
    __pageEditor?: object;
  }
}

const sleep = (ms: number) =>
  new Promise<void>((r) => {
    setTimeout(r, ms);
  });
const frames = () =>
  new Promise<void>((r) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        r();
      }),
    ),
  );

/** One editor over this page: its parts built around the same state. */
class PageEditor implements Editor {
  readonly asks;
  readonly history;
  readonly image;
  readonly input;
  readonly live;
  readonly overlay;
  readonly reload;
  readonly selection;
  readonly structure;
  readonly style;
  readonly text;
  readonly toolbar;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly bridge: PageEditorBridge,
    readonly path: string,
    readonly state: EditorState,
    readonly uiHost: HTMLElement,
    readonly shadow: ShadowRoot,
    readonly ui: Ui,
    readonly watch: PageWatch,
  ) {
    this.overlay = createOverlay(this);
    this.selection = createSelection(this);
    this.toolbar = createToolbar(this);
    this.style = createStyle(this);
    this.history = createHistory(this);
    this.live = createLive(this);
    this.reload = createReload(this);
    this.text = createTextEdit(this);
    this.image = createImage(this);
    this.structure = createStructure(this);
    this.asks = createAsks(this);
    this.input = createInput(this);
  }

  isOurs(e: Event) {
    return e.composedPath().includes(this.uiHost);
  }

  send(message: PageEditorGuestMessage) {
    this.bridge.send(message);
  }

  serial(fn: () => unknown) {
    this.chain = this.chain.then(fn, fn).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- the guest's console is the only place a failed step is seen whole.
      console.error(error);
      this.status(
        `Error: ${error instanceof Error ? error.message : String(error)}`,
        "warn",
      );
    });
    return this.chain;
  }

  status(message: string, kind?: string) {
    this.send({ kind: kind ?? null, message, type: "status" });
  }
}

export async function startEditor(bridge: PageEditorBridge) {
  const { boot } = bridge;
  const watch = pageWatch();
  if (!watch) {
    throw new Error("The page was not watched from its start");
  }
  // The editor's own UI: one element on the page, its contents in a closed
  // shadow root the page's styles and scripts do not reach.
  const uiHost = document.createElement("instrument-page-editor");
  uiHost.setAttribute("data-editor-guest", "");
  uiHost.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;";
  loadFonts();
  const shadow = uiHost.attachShadow({ mode: "closed" });
  // SortableJS finds a drop target by descending through `shadowRoot` from
  // the element under the pointer, which a closed root answers with null.
  // Named on this world's own view of the host, so the page's never has it.
  Object.defineProperty(uiHost, "shadowRoot", { value: shadow });
  shadow.innerHTML = `<style>${CSS}</style>${UI_HTML}`;
  const ui = findUi(shadow);

  // The snapshot the previous load of this edit handed over (see `reload.ts`),
  // or the window's opening state: this editor's own data, round-tripped
  // through the window unchanged.
  const handed = (boot.state ?? {}) as Partial<EditorSnapshot>;

  // The window's answers to saves, by request id.
  const replies = new Map<
    number,
    {
      reject: (error: Error) => void;
      resolve: (result: PageEditorSaveResult) => void;
    }
  >();
  let nextReply = 1;
  const doc = createDoc(
    {
      content: handed.doc?.content ?? boot.src,
      version: handed.doc?.version ?? boot.version,
    },
    (message) =>
      new Promise((resolve, reject) => {
        const id = nextReply++;
        replies.set(id, { reject, resolve });
        bridge.send({ ...message, id, type: "save" });
      }),
  );

  const state: EditorState = {
    A: analyze(boot.src),
    asking: null,
    colors: new Map(),
    doc,
    dragging: false,
    editing: null,
    flashes: [],
    gesture: null,
    hoverEl: null,
    info: null,
    moveLabel: "Add to new chat",
    nextN: handed.nextN ?? 1,
    panelMode: null,
    pendingExternal: false,
    placement: "row",
    preview: null,
    probe: null,
    redoStack: [...(handed.redo ?? [])],
    requests: (handed.requests ?? []).map((r) => ({
      ...r,
      el: null,
      stale: false,
    })),
    sel: null,
    src: boot.src,
    staged: [],
    theme: readTheme(boot.src),
    undoStack: [...(handed.undo ?? [])],
    verdictCache: new WeakMap(),
  };
  const ed = new PageEditor(
    bridge,
    boot.name,
    state,
    uiHost,
    shadow,
    ui,
    watch,
  );

  const applyPlacement = (next: unknown) => {
    state.placement = next === "pill" ? "pill" : "row";
    ui.root.dataset.placement = state.placement;
  };

  // The window's answers: a save's result, the file changing under the page,
  // where the Edit control is drawn, and the file's staged asks.
  bridge.listen((message: PageEditorHostMessage) => {
    switch (message.type) {
      case "external": {
        if (message.version === doc.version) {
          return;
        }
        doc.content = message.content;
        doc.version = message.version;
        ed.reload.onExternalChange();
        break;
      }
      case "flush": {
        // The window is about to read the file another way: the text being
        // typed is committed, and the answer waits behind every write queued.
        if (state.editing) {
          ed.text.commitEdit();
        }
        void ed.serial(() => {
          ed.send({ id: message.id, type: "flushed" });
        });
        break;
      }
      case "placement": {
        applyPlacement(message.placement);
        break;
      }
      case "reply": {
        replies.get(message.id)?.resolve(message.result);
        replies.delete(message.id);
        break;
      }
      case "replyFailed": {
        // Thrown into the step that saved, whose failure the serial chain
        // reports before the next step runs.
        replies.get(message.id)?.reject(new Error(message.error));
        replies.delete(message.id);
        break;
      }
      case "reveal": {
        const r = state.requests.find((entry) => entry.id === message.id);
        if (r?.el?.isConnected) {
          r.el.scrollIntoView({ behavior: "smooth", block: "center" });
          ed.overlay.flash(r.el, 2200);
          setTimeout(ed.overlay.layout, 400);
        }
        break;
      }
      case "staged": {
        // The asks the window still holds for this file, numbered as its pills
        // are: one sent or removed there takes its pin with it, and one moved
        // into a chat leaves the dock's list but keeps its pin until sent.
        const byId = new Map(message.asks.map((a) => [a.id, a]));
        for (let i = state.requests.length - 1; i >= 0; i--) {
          const r = state.requests[i];
          const staged = r ? byId.get(r.id) : undefined;
          if (!r || !staged) {
            state.requests.splice(i, 1);
          } else {
            r.n = staged.n;
            r.moved = staged.moved;
          }
        }
        state.staged = message.asks;
        state.moveLabel = message.moveLabel;
        ed.asks.renderPanel();
        ed.overlay.layout();
        break;
      }
    }
  });

  applyPlacement(handed.placement);
  ed.overlay.init();
  ed.toolbar.init();
  ed.image.init();
  ed.asks.init();
  ed.history.init();
  document.documentElement.append(uiHost);
  ed.input.wire();
  // Into Edit: nothing in hand, the page's cursor and the dock's hint for it.
  ed.selection.select(null);
  ui.pageBtn.hidden = false;
  ui.root.classList.add("editing-mode");
  ed.selection.setHover(null);
  document.documentElement.setAttribute("data-editor-mode", "edit");
  ui.dockHint.hidden = false;
  ed.overlay.layout();
  ed.asks.renderPanel();
  ed.history.updateUndoButtons();

  // The page may hold itself hidden until its styles are in; the scroll and
  // the selection are put back once it shows.
  const t0 = performance.now();
  while (
    document.documentElement.classList.contains("instrument-wait") &&
    performance.now() - t0 < 8000
  ) {
    await sleep(16);
  }
  await frames();
  const colorNames = () => [
    ...state.theme.semantic,
    ...state.theme.ramps.flatMap((r) => r.steps),
  ];
  state.colors = resolveColors(document, colorNames());
  if (handed.scroll) {
    scrollTo(handed.scroll.x, handed.scroll.y);
    await sleep(120);
    scrollTo(handed.scroll.x, handed.scroll.y);
  }
  ed.asks.repin();
  if (handed.sel != null) {
    ed.selection.reselectAt(handed.sel);
  }
  if (handed.panel) {
    ed.style.setPanel(handed.panel === "page" ? "style" : handed.panel);
  }
  if (handed.flash) {
    ed.overlay.flashRanges(handed.flash, handed.flashSelf);
  }
  if (handed.agent) {
    ui.pill.hidden = false;
    find(ui.pill, ".text").textContent = "Updated by Instrument";
    setTimeout(() => {
      ui.pill.hidden = true;
    }, 2600);
  }
  ed.overlay.layout();
  ed.send({ type: "hello", version: doc.version });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    state.colors = resolveColors(document, colorNames());
    if (state.panelMode === "style") {
      ed.style.renderInspector();
    }
  });

  window.__pageEditor = {
    get A() {
      return state.A;
    },
    classify: (el: Element) => classify(state.A, el),
    commitEdit: ed.text.commitEdit,
    get doc() {
      return doc;
    },
    get editing() {
      return state.editing;
    },
    idle: () => ed.serial(() => null),
    get info() {
      return state.info;
    },
    leave: ed.input.leave,
    measure: () => measure(state.A, document),
    openAskFor: ed.asks.openAskFor,
    patchLive: ed.live.patchLive,
    redo: ed.history.redo,
    get requests() {
      return state.requests;
    },
    get sel() {
      return state.sel;
    },
    select: ed.selection.select,
    setPanel: ed.style.setPanel,
    shadow,
    get src() {
      return state.src;
    },
    startEdit: ed.text.startEdit,
    structureOp: ed.structure.structureOp,
    textBlockFor,
    undo: ed.history.undo,
    get undoStack() {
      return state.undoStack;
    },
  };
}

/** The file as the window reports it, written through the window. */
function createDoc(
  init: { content: string; version: string },
  request: (message: {
    baseVersion: string;
    content: string;
  }) => Promise<PageEditorSaveResult>,
): DocHandle {
  const doc: DocHandle = {
    content: init.content,
    async save(next) {
      const result = await request({ baseVersion: doc.version, content: next });
      if (result.ok) {
        doc.content = next;
        doc.version = result.version;
      }
      return result;
    },
    version: init.version,
  };
  return doc;
}

/** The editor's own elements, found once in its shadow root. */
function findUi(shadow: ShadowRoot): Ui {
  const button = (selector: string) =>
    findAs(shadow, selector, HTMLButtonElement);
  return {
    crumbs: find(shadow, "#crumbs"),
    dockAsks: find(shadow, "#dock-asks"),
    dockHint: find(shadow, "#dock-hint"),
    doneBtn: button("#done-btn"),
    flashes: find(shadow, "#flashes"),
    hint: find(shadow, "#edit-hint"),
    hoverBox: find(shadow, "#hover"),
    imgFile: findAs(shadow, "#img-file", HTMLInputElement),
    imgPop: find(shadow, "#img-pop"),
    inspector: find(shadow, "#inspector"),
    layer: find(shadow, "#float-layer"),
    moveBtn: button("#move-btn"),
    pageBtn: button("#page-btn"),
    panel: find(shadow, "#panel"),
    pill: find(shadow, "#agent-pill"),
    pins: find(shadow, "#pins"),
    pop: findAs(shadow, "#popover", HTMLFormElement),
    proxies: find(shadow, "#proxies"),
    redoBtn: button("#redo-btn"),
    reqBtn: button("#req-btn"),
    reqList: find(shadow, "#req-list"),
    root: find(shadow, "#ui"),
    selBox: find(shadow, "#selbox"),
    tb: find(shadow, "#tb"),
    tip: find(shadow, "#tip"),
    toast: find(shadow, "#toast"),
    undoBtn: button("#undo-btn"),
  };
}
