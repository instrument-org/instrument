/**
 * The editor's shape: its state, the elements of its UI, and each part's
 * interface. Every part is built with the whole `Editor` in hand and reaches
 * the others through it, so the parts never import one another.
 */
import {
  type PageEditorGuestMessage,
  type PageEditorSaveResult,
  type PageEditorStagedAsk,
} from "@/shared/page-editor-messages";

import {
  type Blocked,
  type Reason,
  type StaticVerdict,
  type StructureVerdict,
} from "./classify";
import { type PageWatch } from "./observer";
import { type AskVerdict, type RequestPayload, type TextEdit } from "./payload";
import { type AppliedRegion, type Placed, type Region } from "./regions";
import { type CaretAt, type RichText } from "./richtext";
import {
  type Analysis,
  type PageSourceEntry,
  type Range,
  type Segments,
} from "./source";
import { type OffsetMap, type ReorderGesture } from "./structure";
import { type BlockedBy } from "./style-panel";
import { type Theme } from "./tokens";

/** An ask this page holds, pinned to its element. */
export interface AskRequest {
  change: null | string;
  edit: null | TextEdit;
  el: Element | null;
  id: string;
  instruction: string;
  kind: "ask" | "edit";
  /** Moved into a chat, so it leaves the dock's list but keeps its pin. */
  moved?: boolean;
  n: number;
  payload: RequestPayload;
  /** Its element could not be found again. */
  stale: boolean;
}

export interface AsksApi {
  addRequest: (
    el: Element,
    verdict: AskVerdict,
    instruction: string,
    edit: null | TextEdit,
    change: null | string,
  ) => void;
  closeAsk: () => void;
  init: () => void;
  offerAsk: (el: HTMLElement, change: string, reason: Reason) => void;
  openAskFor: (el: HTMLElement) => void;
  placeAsk: () => void;
  renderPanel: () => void;
  repin: () => void;
  toAgent: (e: EditSession, newText: null | string, why: string) => void;
  toAgentChange: (el: HTMLElement, change: string, why: string) => void;
}
/** The file as the window last reported it, and how to write it. */
export interface DocHandle {
  /** The last text known on disk. */
  content: string;
  save: (next: string) => Promise<PageEditorSaveResult>;
  version: string;
}

export interface Editor {
  asks: AsksApi;
  history: HistoryApi;
  image: ImageApi;
  input: InputApi;
  /** Whether an event passed through the editor's own UI. */
  isOurs: (e: Event) => boolean;
  live: LiveApi;
  overlay: OverlayApi;
  /** The file's name. */
  path: string;
  reload: ReloadApi;
  selection: SelectionApi;
  send: (message: PageEditorGuestMessage) => void;
  /** Run `fn` after every step queued before it, reporting a failure. */
  serial: (fn: () => unknown) => Promise<unknown>;
  shadow: ShadowRoot;
  state: EditorState;
  /** A line for the window's status, which it shows only for errors. */
  status: (message: string, kind?: string) => void;
  structure: StructureApi;
  style: StyleApi;
  text: TextEditApi;
  toolbar: ToolbarApi;
  ui: Ui;
  uiHost: HTMLElement;
  watch: PageWatch;
}

/** What one load hands the next: the undo stack, the asks, the selection, the scroll. */
export interface EditorSnapshot {
  agent: boolean;
  doc: { content: string; version: string };
  flash: null | Range[];
  flashSelf: boolean;
  nextN: number;
  panel: "page" | null | PanelMode;
  placement: Placement;
  redo: RedoOp[];
  requests: Omit<AskRequest, "el" | "moved" | "stale">[];
  scroll: null | { x: number; y: number };
  sel: null | number;
  undo: UndoOp[];
}

export interface EditorState {
  A: Analysis;
  asking: Asking | null;
  colors: Map<string, string>;
  doc: DocHandle;
  dragging: boolean;
  editing: EditSession | null;
  flashes: Flash[];
  gesture: null | ReorderGesture;
  hoverEl: HTMLElement | null;
  info: Inspection | null;
  /** What the dock's move button says: into the chat beside the file, or a new one. */
  moveLabel: string;
  nextN: number;
  panelMode: null | PanelMode;
  /** The agent changed the file while something was in hand; applied once it is not. */
  pendingExternal: boolean;
  placement: Placement;
  preview: null | StylePreview;
  probe: null | Probe;
  redoStack: RedoOp[];
  requests: AskRequest[];
  sel: HTMLElement | null;
  /** The text the page and the index describe. */
  src: string;
  /** The file's staged asks as the window last listed them, those staged in earlier Edit sessions included. */
  staged: PageEditorStagedAsk[];
  theme: Theme;
  undoStack: UndoOp[];
  verdictCache: WeakMap<Element, QuickVerdict>;
}

/** A text edit in progress. */
export interface EditSession {
  /** The file's text when the edit started. */
  baseSrc: string;
  el: HTMLElement;
  entry: PageSourceEntry;
  inner: null | Range;
  /** The visible text the edit ended with, once it has. */
  newVisible?: null | string;
  oldText: string;
  /** The rich editor, or null for plain-text editing. */
  rich: null | RichText;
  seg: Segments;
  /** The file's source between the element's tags when the edit started. */
  srcInner: null | string;
}

export type ElementKind = "box" | "image" | "text";

export interface HistoryApi {
  init: () => void;
  redo: () => Promise<void>;
  saveRegions: (regions: Region[]) => Promise<WriteResult>;
  undo: () => Promise<void>;
  updateUndoButtons: () => void;
  write: (write: {
    key: string;
    label: string;
    merge?: boolean;
    regions: Region[];
  }) => Promise<WriteResult>;
}

export interface ImageApi {
  closeImgPop: () => void;
  init: () => void;
  openImgPop: () => void;
}

export interface InputApi {
  leave: () => void;
  wire: () => void;
}

/** What the toolbar and panel need about an element. */
export interface Inspection {
  /** Why it is the agent's, when it is. */
  blocked: Blocked | null;
  entry: null | PageSourceEntry;
  imageOk: boolean;
  kind: ElementKind;
  name: string;
  struct: StructureVerdict;
  style: StaticVerdict;
  styleOk: boolean;
  textOk: boolean;
}

export interface LiveApi {
  applyLive: (write: {
    key: string;
    label: string;
    live: LiveStep;
    regions: Region[];
  }) => Promise<LiveResult>;
  exactlyPlaced: (res: WriteResult, regions: Region[]) => boolean;
  patchLive: (prevA: Analysis, applied: AppliedRegion[]) => boolean;
  quietly: (scope: Node, fn: () => void) => void;
  restamp: (prevA: Analysis, map: OffsetMap, roots?: NewRoot[]) => boolean;
  setChildren: (parent: Element, kids: ChildNode[]) => void;
  /** Run an attribute change the page watch should not count as a script's. */
  withAttributes: (fn: () => void) => void;
}

/** How to bring the live page along when a structural edit is undone or redone. */
export interface LiveStep {
  after: ChildNode[];
  before: ChildNode[];
  fwdRoots: () => NewRoot[];
  invRoots: () => NewRoot[];
  map: OffsetMap;
  parent: HTMLElement;
  /** The page's scripts need the page loaded again to wire the change. */
  reload: boolean;
}

/** New material in the page after a structural edit: live nodes matched in order to the entries in [start, end). */
export interface NewRoot extends Range {
  nodes: Element[];
}

export interface OverlayApi {
  flash: (el: Element, ms: number, self?: boolean) => void;
  flashRanges: (ranges: Range[], self?: boolean) => void;
  init: () => void;
  layout: () => void;
  rectOf: (el: Element | null) => DOMRect | null;
  showToast: (
    msg: string,
    actions?: { redo?: boolean; undo?: boolean },
  ) => void;
}

export type PanelMode = "requests" | "style";

/** A probe of which properties a class cannot change on an element. */
export interface Probe {
  /** Property -> why a class cannot change it; null until the probe finishes. */
  blocked: Map<string, BlockedBy> | null;
  el: HTMLElement;
  promise: Promise<void>;
}

/** The cheap verdict hover needs. */
export interface QuickVerdict {
  blocked: null | Reason;
  kind: ElementKind;
  name: string;
}

export interface ReloadApi {
  afterBusy: () => void;
  applyExternal: () => Promise<void>;
  onExternalChange: () => void;
  reloadKeeping: (
    prev: string,
    selOff?: null | number,
    flashSelf?: boolean,
  ) => Promise<void>;
  reloadWith: (opts: {
    agent?: boolean;
    flash?: null | Range[];
    flashSelf?: boolean;
    sel?: null | number;
  }) => Promise<never>;
}

export interface SelectionApi {
  ancestors: (el: Element) => HTMLElement[];
  init: () => void;
  inspect: (el: Element) => Inspection;
  onClick: (e: MouseEvent) => void;
  onDblClick: (e: MouseEvent) => void;
  onHover: (t: EventTarget | null) => void;
  quick: (el: HTMLElement) => QuickVerdict;
  reselectAt: (offset: null | number) => void;
  select: (el: HTMLElement | null) => void;
  selectParent: () => void;
  selOffset: () => null | number;
  selOffsetIn: (prevA: Analysis) => null | number;
  setHover: (
    el: HTMLElement | null,
    kind?: "edit" | "refuse",
    label?: string,
    sub?: string,
  ) => void;
  verdictCacheReset: () => void;
  watchSize: () => void;
}

export interface StructureApi {
  nudge: (dir: number) => void;
  setupGesture: () => void;
  structureOp: (kind: "delete" | "duplicate") => void;
}

export interface StyleApi {
  clearPreview: () => void;
  refreshColors: () => Promise<void>;
  renderInspector: () => void;
  setPanel: (next: null | PanelMode) => void;
  startProbe: (el: HTMLElement) => void;
}

export interface TextEditApi {
  commitEdit: () => void;
  restoreText: (el: Element, seg: Segments) => boolean;
  startEdit: (el: HTMLElement, at: CaretAt) => void;
}

export interface ToolbarApi {
  crumbsOpen: () => boolean;
  hideCrumbs: () => void;
  init: () => void;
  place: () => void;
  render: () => void;
}

/** The editor's own elements, in its shadow root. */
export interface Ui {
  crumbs: HTMLElement;
  /** The dock's comments: the caret that opens their list, and the button that moves them into a chat. */
  dockAsks: HTMLElement;
  dockHint: HTMLElement;
  doneBtn: HTMLButtonElement;
  flashes: HTMLElement;
  hint: HTMLElement;
  hoverBox: HTMLElement;
  imgFile: HTMLInputElement;
  imgPop: HTMLElement;
  inspector: HTMLElement;
  layer: HTMLElement;
  moveBtn: HTMLButtonElement;
  pageBtn: HTMLButtonElement;
  panel: HTMLElement;
  pill: HTMLElement;
  pins: HTMLElement;
  pop: HTMLFormElement;
  proxies: HTMLElement;
  redoBtn: HTMLButtonElement;
  reqBtn: HTMLButtonElement;
  reqList: HTMLElement;
  root: HTMLElement;
  selBox: HTMLElement;
  tb: HTMLElement;
  tip: HTMLElement;
  toast: HTMLElement;
  undoBtn: HTMLButtonElement;
}

export type WriteResult =
  | { external: boolean; ok: true; placed: Placed; prev: string }
  | { ok: false };

/** An ask being written in the popover. */
interface Asking {
  change: null | string;
  el: HTMLElement;
  verdict: AskVerdict;
}

interface Flash {
  el: Element;
  self?: boolean;
  until: number;
}

/** A write that brought the live page along, and how, for the status line. */
type LiveResult =
  | (Extract<WriteResult, { ok: true }> & { how: string })
  | { ok: false };

type Placement = "pill" | "row";

/** An undone step, holding the regions that redo it. */
type RedoOp = Omit<UndoOp, "regions"> & { regions: Region[] };

/** A style value shown on the live page without being written. */
interface StylePreview {
  el: HTMLElement;
  priority: string;
  prop: string;
  saved: string;
}

interface UndoOp {
  key: string;
  label: string;
  live?: LiveStep;
  regions: AppliedRegion[];
  time: number;
}
