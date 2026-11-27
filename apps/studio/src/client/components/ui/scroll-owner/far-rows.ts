import { scrollTopOf } from "./scroll-owner";

/**
 * Which of a transcript's turns are far from view, drawn as boxes of their
 * last height, and how tall and where every row is.
 *
 * Every row stays in the column in order; a turn far from the viewport keeps
 * its rows with nothing inside them, each as tall as it last measured, so the
 * column is as tall as it was, the scroll owner still finds every row by its
 * message, and the browser's scroll anchoring keeps the reader's place when a
 * box fills in again at a slightly different height. Nothing here writes the
 * scroll position.
 *
 * A turn is a box only while all of these hold: its tab is up (a kept tab
 * behind another keeps the turns it had drawn), every row of it has been
 * measured, none of them is within the band around the viewport, nothing
 * asks to keep it drawn (the last turn, a find, a fold the scroll owner holds
 * still), and the reader holds nothing in it: the selection, the keyboard
 * focus, or an open menu.
 *
 * Heights are layout px, read from the rows' boxes as the resize observer
 * reports them, never from a rect: the window is scaled with CSS `zoom`, and
 * a rect is on-screen px. A far row keeps its own style and holds one empty
 * box as tall as its content was, so a row the browser anchors the view on
 * never changes its own height style as it is drawn again, which would stop
 * the browser keeping the view where it is for that layout.
 */
export class FarRows {
  private viewport: HTMLElement | null = null;
  /** Rows by element: their turn, whether they are near, their last height. */
  private readonly rows = new Map<HTMLElement, RowState>();
  /** Each turn's rows, in no order. */
  private readonly turns = new Map<string, Set<HTMLElement>>();
  /** What else keeps a turn drawn, by who asked. */
  private readonly kept = new Map<string, ReadonlySet<string>>();
  private readonly boxed = new Set<string>();
  /**
   * What each boxed turn had drawn as it boxed, for finding a box by what is
   * in it: its elements' ids and its words, whitespace aside.
   */
  private readonly boxedContent = new Map<string, BoxedContent>();
  private boxedView: ReadonlySet<string> = new Set();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly boxListeners = new Set<() => void>();
  private nearObserver: IntersectionObserver | null = null;
  private farObserver: IntersectionObserver | null = null;
  private sizes: ResizeObserver | null = null;
  private isShown = true;
  private frame = 0;
  private isListening = false;

  /** Asked whether a row holds something the scroll owner is keeping still. */
  constructor(private readonly isHeldByOwner: (row: HTMLElement) => boolean) {}

  // -- wiring -----------------------------------------------------------------

  setViewport = (element: HTMLElement | null) => {
    if (this.viewport === element) {
      return;
    }
    this.viewport = element;
    this.observe();
  };

  /** Watches again after `dispose`, the rows and viewport it was last given. */
  connect() {
    this.observe();
    this.listen();
  }

  dispose() {
    this.nearObserver?.disconnect();
    this.farObserver?.disconnect();
    this.sizes?.disconnect();
    this.nearObserver = null;
    this.farObserver = null;
    this.sizes = null;
    cancelAnimationFrame(this.frame);
    this.unlisten();
  }

  private observe() {
    this.nearObserver?.disconnect();
    this.farObserver?.disconnect();
    this.sizes?.disconnect();
    this.sizes = new ResizeObserver((entries) => {
      this.onResize(entries);
    });
    const viewport = this.viewport;
    // Drawn on coming within two screens of the viewport, a box once past
    // three, so a reader going back and forth over the edge of the band does
    // not fill and empty the same turn.
    this.nearObserver = viewport
      ? new IntersectionObserver(
          (entries) => {
            this.onIntersect(entries, true);
          },
          {
            root: viewport,
            rootMargin: `${(NEAR_SCREENS * 100).toString()}% 0px`,
          },
        )
      : null;
    this.farObserver = viewport
      ? new IntersectionObserver(
          (entries) => {
            this.onIntersect(entries, false);
          },
          {
            root: viewport,
            rootMargin: `${(FAR_SCREENS * 100).toString()}% 0px`,
          },
        )
      : null;
    for (const row of this.rows.keys()) {
      this.sizes.observe(row);
      this.nearObserver?.observe(row);
      this.farObserver?.observe(row);
    }
  }

  /** A row of `turn` as it mounts, or again as `keep`, which holds it drawn, changes. */
  register(turn: string, row: HTMLElement, keep: boolean) {
    const known = this.rows.get(row);
    if (known) {
      known.keep = keep;
      this.update(turn);
      return;
    }
    this.rows.set(row, {
      height: undefined,
      inner: undefined,
      isNear: true,
      width: undefined,
      keep,
      turn,
    });
    let rows = this.turns.get(turn);
    if (!rows) {
      rows = new Set();
      this.turns.set(turn, rows);
    }
    rows.add(row);
    this.sizes ??= new ResizeObserver((entries) => {
      this.onResize(entries);
    });
    this.sizes.observe(row);
    this.nearObserver?.observe(row);
    this.farObserver?.observe(row);
    this.listen();
  }

  unregister(row: HTMLElement) {
    const state = this.rows.get(row);
    if (!state) {
      return;
    }
    this.rows.delete(row);
    this.sizes?.unobserve(row);
    this.nearObserver?.unobserve(row);
    this.farObserver?.unobserve(row);
    const rows = this.turns.get(state.turn);
    rows?.delete(row);
    if (rows?.size === 0) {
      this.turns.delete(state.turn);
      this.setBoxed(state.turn, false);
    } else {
      this.update(state.turn);
    }
  }

  /**
   * Whether the transcript's tab is up. While it is not, every turn stays as
   * it is: a kept tab is laid out but not looked at, and draws nothing new.
   */
  setShown(isShown: boolean) {
    if (this.isShown === isShown) {
      return;
    }
    this.isShown = isShown;
    if (isShown) {
      this.updateAll();
    }
  }

  /** Keeps `turns` drawn for `by`, in place of what it kept before. */
  keep(by: string, turns: ReadonlySet<string>) {
    const was = this.kept.get(by);
    if (turns.size === 0) {
      this.kept.delete(by);
    } else {
      this.kept.set(by, turns);
    }
    for (const turn of new Set([...(was ?? []), ...turns])) {
      this.update(turn);
    }
  }

  // -- reading ----------------------------------------------------------------

  /** Whether `turn` is drawn as boxes. */
  isBoxed = (turn: string): boolean => this.boxed.has(turn);

  /**
   * How tall the box inside a row far from view is drawn: the height its
   * content had when last measured, so the row, its padding around the box,
   * is as tall as it was.
   */
  boxHeightOf(row: HTMLElement): number | undefined {
    return this.rows.get(row)?.inner;
  }

  subscribe(turn: string, listener: () => void): () => void {
    let set = this.listeners.get(turn);
    if (!set) {
      set = new Set();
      this.listeners.set(turn, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) {
        this.listeners.delete(turn);
      }
    };
  }

  /**
   * The boxed turns, in the column's order, that had drawn an element named
   * `id` or the words `words` (whitespace aside) as they boxed: where a link
   * or a quote lands when nothing drawn has it.
   */
  boxesHaving(match: { id: string } | { words: string }): string[] {
    const turns: { row: HTMLElement; turn: string }[] = [];
    for (const [turn, content] of this.boxedContent) {
      const has =
        "id" in match
          ? content.ids.has(match.id)
          : content.words.includes(match.words.replaceAll(/\s/g, ""));
      const row = this.turns.get(turn)?.values().next().value;
      if (has && row) {
        turns.push({ row, turn });
      }
    }
    turns.sort((a, b) =>
      a.row.compareDocumentPosition(b.row) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1,
    );
    return turns.map(({ turn }) => turn);
  }

  /** The turns drawn as boxes, a new set each time it changes. */
  getBoxed = (): ReadonlySet<string> => this.boxedView;

  subscribeBoxed = (listener: () => void): (() => void) => {
    this.boxListeners.add(listener);
    return () => {
      this.boxListeners.delete(listener);
    };
  };

  /**
   * Every row a turn has, in the column's order: its turn, its top in the
   * viewport's scroll coordinates, its height, and whether it is a box. The
   * one place to read where each turn is without drawing it, for anything
   * that lists or marks the turns down the whole transcript.
   */
  places(): RowPlace[] {
    const viewport = this.viewport;
    if (!viewport) {
      return [];
    }
    const rows = [...this.rows.keys()].filter((row) => row.isConnected);
    rows.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    return rows.map((row) => {
      const state = this.rows.get(row);
      return {
        height: state?.height ?? row.offsetHeight,
        isBox: state ? this.boxed.has(state.turn) : false,
        row,
        top: scrollTopOf(row, viewport),
        turn: state?.turn ?? "",
      };
    });
  }

  // -- deciding ---------------------------------------------------------------

  private onIntersect(
    entries: IntersectionObserverEntry[],
    isNearBand: boolean,
  ) {
    const touched = new Set<string>();
    for (const entry of entries) {
      const row = entry.target;
      const state = row instanceof HTMLElement ? this.rows.get(row) : undefined;
      if (!state) {
        continue;
      }
      // The near band only draws, the far band only lets go.
      if (isNearBand && entry.isIntersecting && !state.isNear) {
        state.isNear = true;
        touched.add(state.turn);
      } else if (!isNearBand && !entry.isIntersecting && state.isNear) {
        state.isNear = false;
        touched.add(state.turn);
      }
    }
    for (const turn of touched) {
      this.update(turn);
    }
  }

  private onResize(entries: ResizeObserverEntry[]) {
    const touched = new Set<string>();
    const rescaled = new Set<string>();
    for (const entry of entries) {
      const row = entry.target;
      const state = row instanceof HTMLElement ? this.rows.get(row) : undefined;
      if (!state) {
        continue;
      }
      const width = entry.contentBoxSize[0]?.inlineSize ?? 0;
      if (this.boxed.has(state.turn)) {
        // A box keeps the height it was drawn at, but for its width: a zoom
        // or a narrower window wraps its words onto more lines, so its height
        // goes as its width does the other way.
        if (rescale(state, width)) {
          rescaled.add(state.turn);
        }
        continue;
      }
      if (state.height === undefined) {
        touched.add(state.turn);
      }
      state.height = entry.borderBoxSize[0]?.blockSize ?? 0;
      state.inner = entry.contentBoxSize[0]?.blockSize ?? 0;
      state.width = width;
    }
    for (const turn of touched) {
      this.update(turn);
    }
    for (const turn of rescaled) {
      for (const listener of this.listeners.get(turn) ?? []) {
        listener();
      }
    }
  }

  private updateAll() {
    for (const turn of this.turns.keys()) {
      this.update(turn);
    }
  }

  private update(turn: string) {
    if (!this.isShown) {
      return;
    }
    this.setBoxed(turn, this.isFar(turn));
  }

  private isFar(turn: string): boolean {
    const rows = this.turns.get(turn);
    if (!rows || rows.size === 0) {
      return false;
    }
    for (const keeps of this.kept.values()) {
      if (keeps.has(turn)) {
        return false;
      }
    }
    for (const row of rows) {
      const state = this.rows.get(row);
      if (!state || state.isNear || state.keep || state.height === undefined) {
        return false;
      }
    }
    // Asked last, being the only question that reads the page.
    for (const row of rows) {
      if (this.isHeldByOwner(row) || isHeldByReader(row)) {
        return false;
      }
    }
    return true;
  }

  private setBoxed(turn: string, isBoxed: boolean) {
    if (this.boxed.has(turn) === isBoxed) {
      return;
    }
    if (isBoxed) {
      this.boxed.add(turn);
      // Read before anything is told, while the rows still have what they drew.
      const rows = [...(this.turns.get(turn) ?? [])];
      this.boxedContent.set(turn, {
        ids: new Set(
          rows.flatMap((row) =>
            [...row.querySelectorAll("[id]")].map((element) => element.id),
          ),
        ),
        words: rows
          .map((row) => row.textContent)
          .join("")
          .replaceAll(/\s/g, ""),
      });
    } else {
      this.boxed.delete(turn);
      this.boxedContent.delete(turn);
    }
    this.boxedView = new Set(this.boxed);
    for (const listener of this.listeners.get(turn) ?? []) {
      listener();
    }
    for (const listener of this.boxListeners) {
      listener();
    }
  }

  // -- what the reader holds ------------------------------------------------------

  /**
   * A turn the reader held when it went far is looked at again as what they
   * hold moves: the selection, the focus, a menu closing back onto its button.
   */
  private readonly recheck = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => {
      this.updateAll();
    });
  };

  private listen() {
    if (this.isListening || typeof document === "undefined") {
      return;
    }
    this.isListening = true;
    document.addEventListener("selectionchange", this.recheck);
    document.addEventListener("focusin", this.recheck);
    document.addEventListener("focusout", this.recheck);
  }

  private unlisten() {
    if (!this.isListening) {
      return;
    }
    this.isListening = false;
    document.removeEventListener("selectionchange", this.recheck);
    document.removeEventListener("focusin", this.recheck);
    document.removeEventListener("focusout", this.recheck);
  }
}

/** Drawn within this many viewport heights above and below the viewport. */
const NEAR_SCREENS = 2;
/** A box once further than this many. */
const FAR_SCREENS = 3;

interface BoxedContent {
  ids: ReadonlySet<string>;
  words: string;
}

interface RowState {
  /** Last measured, in layout px; none until it has been drawn and measured. */
  height: number | undefined;
  /** Its content box's height when last measured, in layout px. */
  inner: number | undefined;
  /** Its content box's width when last measured, in layout px. */
  width: number | undefined;
  /** Within the band: came within `NEAR_SCREENS` and has not gone past `FAR_SCREENS`. */
  isNear: boolean;
  /** Its item asks to stay drawn. */
  keep: boolean;
  turn: string;
}

/**
 * Scales a box's heights for its new `width`, as wrapped words take lines in
 * the inverse of the width they have; whether they changed.
 */
function rescale(state: RowState, width: number): boolean {
  const { height, inner } = state;
  if (
    width <= 0 ||
    state.width === undefined ||
    state.width === width ||
    height === undefined ||
    inner === undefined
  ) {
    return false;
  }
  const next = (inner * state.width) / width;
  state.height = height + next - inner;
  state.inner = next;
  state.width = width;
  return true;
}

export interface RowPlace {
  height: number;
  isBox: boolean;
  row: HTMLElement;
  /** In the viewport's scroll coordinates, in layout px. */
  top: number;
  turn: string;
}

/** Whether the selection, the keyboard focus or an open menu is in `row`. */
function isHeldByReader(row: HTMLElement): boolean {
  const active = document.activeElement;
  if (active && active !== document.body && row.contains(active)) {
    return true;
  }
  const selection = document.getSelection();
  if (
    selection &&
    selection.rangeCount > 0 &&
    !selection.isCollapsed &&
    selection.getRangeAt(0).intersectsNode(row)
  ) {
    return true;
  }
  // A menu's or popover's button; a disclosure (a Worked row) opens in place.
  return row.querySelector('[aria-haspopup][aria-expanded="true"]') !== null;
}
