import {
  type ScrollGeometry,
  type ScrollMode,
  type ScrollSettings,
  SAME_POSITION,
  endOf,
  isAtEnd,
  pinned,
  scrollableOf,
  settle,
} from "./policy";

/** What the edges show: whether there is more to scroll to at each. */
export interface Scrollable {
  end: boolean;
  start: boolean;
}

export interface ScrollOptions {
  align?: "start";
  scrollMargin?: number;
}

/** The keys that scroll a focused viewport. */
const SCROLL_KEYS = new Set([
  " ",
  "ArrowDown",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);

/** How long a send waits for its message to be drawn before its slide is dropped. */
const SLIDE_WAIT_MS = 5000;
/** How long the transcript takes to carry a message just sent up to where it rests. */
const SLIDE_MS = 360;
/** The curve the transcript's other motion moves on: quick to answer, slow to land. */
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
/** Below this there is nothing to see move. */
const SLIDE_MIN_PX = 4;
/** How long after the reader's input a scroll counts as theirs. */
const INPUT_SCROLL_MS = 300;
/** How long the content may go without growing before an arrival counts as settled. */
const SETTLE_MS = 250;
/** How long the end is held after arriving, at most, however long the content keeps growing. */
const SETTLE_MAX_MS = 4000;

/**
 * The one thing that writes a transcript's scroll position.
 *
 * It measures once and writes once per change, from the browser's own
 * callbacks for resizes and added rows, which run after layout and before
 * paint, so no frame is drawn at a position it then corrects. What it writes
 * is `settle`'s answer for the mode it is in, and the mode changes only on the
 * reader's input, a send, or a command (`policy.ts`).
 *
 * Positions are read from layout offsets rather than rects, so a transform on
 * the content (the send's slide) and the window's zoom never enter them.
 */
export class ScrollOwner {
  private mode: ScrollMode = { kind: "follow" };
  private settings: ScrollSettings;
  private root: HTMLElement | null = null;
  private viewport: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private spacer: HTMLElement | null = null;
  private spacerHeight = 0;
  private readonly items = new Map<string, HTMLElement>();
  private readonly observed = new Set<HTMLElement>();
  private readonly anchorsSeen = new WeakSet<Element>();
  private anchorElement: HTMLElement | null = null;
  private resizes: ResizeObserver | null = null;
  private mutations: MutationObserver | null = null;
  /**
   * The row held still on screen while what is above it changes (`holdPin`),
   * and how far below the viewport's top it is held.
   */
  private pin: {
    element: HTMLElement;
    /** Held: false once a move the reader or the app asked for came, which leaves it where that put it. */
    isHeld: boolean;
    /** The reader took over: where their next scroll puts it is where it is held. */
    isRetaken: boolean;
    screenTop: number;
  } | null = null;
  private lastInputAt = Number.NEGATIVE_INFINITY;
  private pendingJump: { messageId: string; options?: ScrollOptions } | null =
    null;
  private hasOpened = false;
  /**
   * Taking the end is an arrival, and what arrived lays out for a while after
   * (images size themselves, cards fetch what they show), so the end is held
   * until the content stops growing, even where nothing else can arrive.
   */
  private settleQuietUntil = 0;
  /**
   * Set from a call to take the end until the next frame: rows landing with it
   * (a chat's messages arriving after its spinner) are what was being opened,
   * never a send.
   */
  private isTakingEnd = false;
  private settleCapUntil = 0;
  private lastContentBottom = 0;
  private slideArmed = false;
  private slideArmedTimer = 0;
  private slide: Animation | null = null;
  private scrollable: Scrollable = { end: false, start: false };
  private readonly listeners = new Set<() => void>();

  /** Where a transcript opens: at its end, or at its start. */
  private readonly opensAt: "end" | "start";

  constructor(settings: ScrollSettings, opensAt: "end" | "start" = "end") {
    this.settings = settings;
    this.opensAt = opensAt;
  }

  // -- wiring ---------------------------------------------------------------

  setRoot = (element: HTMLElement | null) => {
    this.root = element;
  };

  setViewport = (element: HTMLElement | null) => {
    if (this.viewport === element) {
      return;
    }
    this.detachViewport();
    this.viewport = element;
    if (!element) {
      return;
    }
    element.addEventListener("scroll", this.onScroll, { passive: true });
    element.addEventListener("wheel", this.onWheel, { passive: true });
    element.addEventListener("touchmove", this.onInput, { passive: true });
    element.addEventListener("keydown", this.onKey);
    element.addEventListener("pointerdown", this.onPointer);
    this.observe(element);
    // The column's ref is attached before the viewport's, so a transcript
    // drawn whole opens here.
    if (!this.hasOpened) {
      this.onRowsChanged([]);
    }
  };

  setContent = (element: HTMLElement | null) => {
    if (this.content === element) {
      return;
    }
    this.mutations?.disconnect();
    this.content = element;
    if (!element) {
      return;
    }
    this.mutations = new MutationObserver((records) => {
      this.onRowsChanged(records);
    });
    this.mutations.observe(element, { childList: true });
    this.onRowsChanged([]);
  };

  setSpacer = (element: HTMLElement | null) => {
    this.spacer = element;
  };

  registerItem(messageId: string | undefined, element: HTMLElement | null) {
    if (element) {
      this.observe(element);
    }
    if (!messageId) {
      return;
    }
    if (element) {
      this.items.set(messageId, element);
      if (this.pendingJump?.messageId === messageId) {
        const { options } = this.pendingJump;
        this.pendingJump = null;
        this.jumpTo(element, options);
      }
    } else {
      this.items.delete(messageId);
    }
  }

  unregisterElement(element: HTMLElement) {
    this.observed.delete(element);
    this.resizes?.unobserve(element);
  }

  updateSettings(settings: ScrollSettings) {
    const wasFollowing = this.settings.autoScroll;
    this.settings = settings;
    // Something starting to arrive while the reader sits at the end: they
    // were reading the end, so the end is where they stay.
    if (!wasFollowing && settings.autoScroll && this.mode.kind === "keep") {
      const geometry = this.measure();
      if (geometry && isAtEnd(geometry)) {
        this.mode = { kind: "follow" };
      }
    }
    this.reconcile();
  }

  /** Listens again after `dispose`, to the elements it was last given. */
  connect() {
    const { content, viewport } = this;
    this.viewport = null;
    this.content = null;
    this.setViewport(viewport);
    this.setContent(content);
  }

  dispose() {
    this.detachViewport();
    this.mutations?.disconnect();
    this.resizes?.disconnect();
    this.resizes = null;
    this.observed.clear();
    this.stopSlide();
    window.clearTimeout(this.slideArmedTimer);
  }

  // -- reading ----------------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getScrollable = (): Scrollable => this.scrollable;

  /** The mode as it stands, for tests and the debug page. */
  getMode(): ScrollMode {
    return this.mode;
  }

  // -- commands ---------------------------------------------------------------

  /** To the end, following it from there while anything can arrive. */
  scrollToEnd = (options?: { behavior?: ScrollBehavior }) => {
    const viewport = this.viewport;
    if (!viewport) {
      return false;
    }
    this.stopSlide();
    this.unpin();
    this.mode = { kind: "follow" };
    if (!this.isTakingEnd) {
      this.isTakingEnd = true;
      requestAnimationFrame(() => {
        this.isTakingEnd = false;
      });
    }
    const now = performance.now();
    this.settleCapUntil = now + SETTLE_MAX_MS;
    this.settleQuietUntil = now + SETTLE_MS;
    this.writeSpacer(0);
    const geometry = this.measure();
    if (geometry) {
      this.writeScroll(endOf(geometry), options?.behavior);
    }
    this.publish();
    return true;
  };

  scrollToStart = () => {
    if (!this.viewport) {
      return false;
    }
    this.stopSlide();
    this.unpin();
    this.mode = { kind: "keep" };
    this.writeSpacer(0);
    this.writeScroll(0);
    this.publish();
    return true;
  };

  /** Brings a message's row to the top, and leaves the reader there. */
  scrollToMessage = (messageId: string, options?: ScrollOptions) => {
    const element = this.items.get(messageId);
    if (!element) {
      this.pendingJump = { messageId, options };
      return true;
    }
    this.jumpTo(element, options);
    return true;
  };

  /**
   * Leaves the reader where they are, for a control about to grow what is on
   * screen: following would carry what they opened away from under them.
   */
  releaseAutoScroll = () => {
    // What they opened grows down from where they clicked.
    this.unpin();
    if (this.mode.kind !== "keep") {
      this.mode = { kind: "keep" };
      this.publish();
    }
  };

  /** Animates the move to the next message the person sends, called before it is drawn. */
  armSlide = () => {
    this.slideArmed = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    window.clearTimeout(this.slideArmedTimer);
    this.slideArmedTimer = window.setTimeout(() => {
      this.slideArmed = false;
    }, SLIDE_WAIT_MS);
  };

  // -- the one write -----------------------------------------------------------

  /** Measures, asks the policy, writes. Safe to call at any time. */
  reconcile = () => {
    const geometry = this.measure();
    if (!geometry) {
      return;
    }
    const now = performance.now();
    const grew = geometry.contentBottom > this.lastContentBottom;
    if (grew) {
      this.settleQuietUntil = now + SETTLE_MS;
    }
    // Still at the end the content had before it grew: the reader was
    // reading the end, so what lands there after the turn (a rating card, a
    // late picture) stays in view.
    const isGrowingAtEnd =
      grew &&
      this.lastContentBottom > 0 &&
      this.mode.kind === "follow" &&
      geometry.scrollTop + geometry.viewportHeight >=
        this.lastContentBottom - SAME_POSITION;
    this.lastContentBottom = geometry.contentBottom;
    const effective = this.effectiveSettings(now);
    const settings = isGrowingAtEnd
      ? { ...effective, autoScroll: true }
      : effective;
    let write = settle(this.mode, geometry, settings);
    const pin = this.pin;
    if (this.viewport && pin?.isHeld && pin.element.isConnected) {
      write = pinned(
        write,
        geometry,
        settings,
        scrollTopOf(pin.element, this.viewport) - pin.screenTop,
      );
    }
    this.mode = write.mode;
    if (write.mode.kind !== "anchor") {
      this.anchorElement = null;
    }
    this.writeSpacer(write.spacer);
    if (write.scrollTop !== undefined) {
      this.writeScroll(write.scrollTop);
    }
    // While the end is followed, the held row goes where following puts it,
    // and is held from there once following stops.
    if (
      pin?.isHeld &&
      write.mode.kind === "follow" &&
      settings.autoScroll &&
      pin.element.isConnected
    ) {
      pin.screenTop = this.screenTopOf(pin.element) ?? pin.screenTop;
    }
    this.publish(geometry);
  };

  /** The settings, with the end held while an arrival settles. */
  private effectiveSettings(now = performance.now()): ScrollSettings {
    const isArriving = now < this.settleQuietUntil && now < this.settleCapUntil;
    return isArriving ? { ...this.settings, autoScroll: true } : this.settings;
  }

  // -- events -----------------------------------------------------------------

  private onRowsChanged(records: readonly MutationRecord[]) {
    const content = this.content;
    if (!content) {
      return;
    }
    for (const element of this.observed) {
      if (!element.isConnected) {
        this.unregisterElement(element);
      }
    }
    for (const row of content.children) {
      if (row instanceof HTMLElement && row !== this.spacer) {
        this.observe(row);
      }
    }
    const anchors = [
      ...content.querySelectorAll<HTMLElement>(
        ':scope > [data-scroll-anchor="true"]',
      ),
    ];
    const fresh = anchors.filter((anchor) => !this.anchorsSeen.has(anchor));
    for (const anchor of fresh) {
      this.anchorsSeen.add(anchor);
    }
    // The first rows a scroller gets are a chat opening, not a send: it opens
    // at its end.
    if (!this.hasOpened) {
      const hasRows = [...content.children].some((row) => row !== this.spacer);
      if (this.viewport && hasRows) {
        this.hasOpened = true;
        if (this.opensAt === "start") {
          this.scrollToStart();
        } else {
          this.scrollToEnd();
        }
      }
      return;
    }
    if (this.isTakingEnd) {
      this.reconcile();
      return;
    }
    const sent = fresh.at(-1);
    // One message arriving is a send. Several at once are a page of history
    // drawn in, which leaves the reader where they are.
    if (sent && fresh.length === 1 && sent === anchors.at(-1)) {
      this.anchorTo(sent);
      return;
    }
    this.keepPlaceAtTop(records);
    this.reconcile();
  }

  /**
   * Rows drawn in above a reader at the very top leave what they were reading
   * where it was. The browser's scroll anchoring keeps the reader's place
   * anywhere else, but anchors nothing at a scroll position of 0, so the page
   * of history that loads as the reader reaches the top would push what they
   * were reading down by its height. When the first rows are new, with
   * nothing but rows that are not messages (the loader) above them, the
   * first row that was there before goes back to where the first new row
   * starts, which is where it was.
   */
  private keepPlaceAtTop(records: readonly MutationRecord[]) {
    const viewport = this.viewport;
    const content = this.content;
    if (
      !viewport ||
      !content ||
      this.mode.kind !== "keep" ||
      viewport.scrollTop > SAME_POSITION / 2
    ) {
      return;
    }
    const added = new Set(records.flatMap((record) => [...record.addedNodes]));
    const rows = [...content.children].filter(
      (row): row is HTMLElement =>
        row instanceof HTMLElement && row !== this.spacer,
    );
    const first = rows.findIndex((row) => added.has(row));
    const kept = rows.slice(first + 1).find((row) => !added.has(row));
    const drawnIn = rows[first];
    if (
      first === -1 ||
      !drawnIn ||
      !kept ||
      rows
        .slice(0, first)
        .some((row) => row.hasAttribute("data-message-scroller-item"))
    ) {
      return;
    }
    this.writeScroll(
      scrollTopOf(kept, viewport) - scrollTopOf(drawnIn, viewport),
    );
  }

  private onResize = () => {
    this.reconcile();
  };

  private onScroll = () => {
    const pin = this.pin;
    if (pin?.isRetaken && this.viewport) {
      pin.isRetaken = false;
      pin.screenTop =
        scrollTopOf(pin.element, this.viewport) - this.viewport.scrollTop;
    }
    const geometry = this.measure();
    if (!geometry) {
      return;
    }
    // Scrolling by hand back to the end picks following up again.
    if (
      this.mode.kind === "keep" &&
      performance.now() - this.lastInputAt < INPUT_SCROLL_MS &&
      isAtEnd(geometry) &&
      this.spacerHeight === 0
    ) {
      this.mode = { kind: "follow" };
    }
    if (this.mode.kind === "keep") {
      // A reader scrolling up through room the spacer left takes it away
      // behind them, so the end is never further than what is there.
      this.writeSpacer(settle(this.mode, geometry, this.settings).spacer);
    }
    this.publish(geometry);
  };

  private onInput = () => {
    this.takeOver();
  };

  /**
   * A wheel takes over only when it can move the transcript: never one that
   * goes sideways, one a table or code block inside scrolls instead, or one
   * pushing down past an end already reached, which fires no scroll to hand
   * following back.
   */
  private onWheel = (event: WheelEvent) => {
    const viewport = this.viewport;
    if (!viewport || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      return;
    }
    if (
      event.target instanceof Element &&
      scrollsInside(event.target, viewport, event.deltaY)
    ) {
      return;
    }
    const geometry = this.measure();
    if (event.deltaY > 0 && geometry && isAtEnd(geometry)) {
      return;
    }
    this.takeOver();
  };

  private onKey = (event: KeyboardEvent) => {
    if (SCROLL_KEYS.has(event.key) && event.target === this.viewport) {
      this.takeOver();
    }
  };

  private onPointer = (event: PointerEvent) => {
    // A press on the viewport itself is its scrollbar. One on a row is not scrolling.
    if (event.target === this.viewport) {
      this.takeOver();
    }
  };

  private takeOver() {
    this.lastInputAt = performance.now();
    if (this.pin) {
      this.pin.isRetaken = true;
    }
    if (this.slide) {
      this.stopSlide();
    }
    if (this.mode.kind !== "keep") {
      this.mode = { kind: "keep" };
      this.publish();
    }
  }

  // -- moves ------------------------------------------------------------------

  private anchorTo(element: HTMLElement) {
    this.unpin();
    const viewport = this.viewport;
    const before = viewport?.scrollTop ?? 0;
    const geometry = this.measure(element);
    if (!viewport || !geometry) {
      return;
    }
    this.anchorElement = element;
    this.mode = {
      contentAtAnchor: geometry.contentBottom,
      key: element.dataset.messageId ?? "anchor",
      kind: "anchor",
    };
    this.reconcile();
    if (this.slideArmed) {
      this.slideArmed = false;
      window.clearTimeout(this.slideArmedTimer);
      this.startSlide(viewport.scrollTop - before);
    }
  }

  private jumpTo(element: HTMLElement, options?: ScrollOptions) {
    const viewport = this.viewport;
    if (!viewport) {
      return;
    }
    this.stopSlide();
    this.unpin();
    this.mode = { kind: "keep" };
    const top = scrollTopOf(element, viewport);
    const margin = options?.scrollMargin ?? 0;
    this.writeScroll(Math.max(0, top - margin));
    this.publish();
  }

  private startSlide(distance: number) {
    const content = this.content;
    const viewport = this.viewport;
    if (!content || !viewport) {
      return;
    }
    // From far up there is nothing to keep in view, and a screenful reads as
    // the same motion where thousands of pixels in a third of a second blur.
    const room = viewport.clientHeight;
    const shown = Math.min(Math.max(distance, -room), room);
    if (Math.abs(shown) < SLIDE_MIN_PX) {
      return;
    }
    this.root?.toggleAttribute("data-sliding", true);
    this.slide = content.animate(
      { transform: [`translateY(${shown.toString()}px)`, "translateY(0)"] },
      { duration: SLIDE_MS, easing: SLIDE_EASING },
    );
    this.slide.onfinish = () => {
      this.slide = null;
      this.root?.toggleAttribute("data-sliding", false);
      this.publish();
    };
  }

  /** Ends a slide where it is on screen, which is where the reader is looking. */
  private stopSlide() {
    const slide = this.slide;
    const content = this.content;
    const viewport = this.viewport;
    if (!slide) {
      return;
    }
    this.slide = null;
    const left = content
      ? new DOMMatrixReadOnly(getComputedStyle(content).transform).m42
      : 0;
    slide.onfinish = null;
    slide.cancel();
    if (viewport) {
      viewport.scrollTop -= left;
    }
    this.root?.toggleAttribute("data-sliding", false);
  }

  // -- the pinned row ------------------------------------------------------------

  /** How far below the viewport's top a row is, in layout px. */
  screenTopOf = (element: HTMLElement): number | undefined => {
    const viewport = this.viewport;
    return viewport
      ? scrollTopOf(element, viewport) - viewport.scrollTop
      : undefined;
  };

  /**
   * Holds a row still on screen while what is above it changes, at
   * `screenTop` (where it was before the render that moved anything, when the
   * caller read it then) or where it is now.
   */
  holdPin = (element: HTMLElement, screenTop = this.screenTopOf(element)) => {
    const viewport = this.viewport;
    if (!viewport || screenTop === undefined) {
      return;
    }
    this.pin = {
      element,
      // Out of sight below, what is in view is above what moves, and holding
      // the row would carry it away.
      isHeld: screenTop < viewport.clientHeight,
      isRetaken: false,
      screenTop,
    };
  };

  /**
   * Whether `row` has what this keeps in place: the row held still while a
   * fold closes above it, or the message just sent while its reply arrives.
   */
  holds = (row: HTMLElement): boolean =>
    (this.pin !== null && row.contains(this.pin.element)) ||
    (this.mode.kind === "anchor" &&
      this.anchorElement !== null &&
      row.contains(this.anchorElement));

  /** Lets a held row go. */
  releasePin = (element: HTMLElement) => {
    if (this.pin?.element === element) {
      this.pin = null;
    }
  };

  /** Stops holding the marked row still, for a move the reader or the app asked for. */
  private unpin() {
    if (this.pin) {
      this.pin.isHeld = false;
    }
  }

  // -- measuring and writing -----------------------------------------------------

  private measure(anchor = this.anchorElement): ScrollGeometry | null {
    const viewport = this.viewport;
    const content = this.content;
    if (!viewport || !content) {
      return null;
    }
    const contentBottom =
      scrollTopOf(content, viewport) + content.offsetHeight - this.spacerHeight;
    return {
      ...(anchor?.isConnected && {
        anchorTop: scrollTopOf(anchor, viewport),
      }),
      contentBottom,
      scrollTop: viewport.scrollTop,
      spacer: this.spacerHeight,
      topInset: Number.parseFloat(getComputedStyle(content).paddingTop) || 0,
      viewportHeight: viewport.clientHeight,
    };
  }

  private writeSpacer(height: number) {
    const spacer = this.spacer;
    const next = Math.max(0, Math.ceil(height));
    if (!spacer || next === this.spacerHeight) {
      return;
    }
    this.spacerHeight = next;
    spacer.hidden = next === 0;
    spacer.style.height = `${next.toString()}px`;
    // The content's gap would otherwise come with it.
    const gap = spacer.parentElement
      ? Number.parseFloat(getComputedStyle(spacer.parentElement).rowGap) || 0
      : 0;
    spacer.style.marginTop = next > 0 ? `${(-gap).toString()}px` : "";
  }

  private writeScroll(top: number, behavior: ScrollBehavior = "instant") {
    const viewport = this.viewport;
    if (!viewport) {
      return;
    }
    if (Math.abs(viewport.scrollTop - top) <= SAME_POSITION / 2) {
      return;
    }
    if (behavior === "smooth") {
      viewport.scrollTo({ behavior, top });
    } else {
      viewport.scrollTop = top;
    }
  }

  private publish(geometry = this.measure()) {
    if (!geometry) {
      return;
    }
    const next = scrollableOf(this.mode, geometry, this.effectiveSettings());
    // A slide counts as room left to scroll while it runs.
    if (this.slide) {
      next.end = false;
    }
    for (const element of [this.root, this.viewport]) {
      if (!element) {
        continue;
      }
      const edges = [next.start && "start", next.end && "end"]
        .filter(Boolean)
        .join(" ");
      if (edges) {
        element.setAttribute("data-scrollable", edges);
      } else {
        element.removeAttribute("data-scrollable");
      }
      element.dataset.scrollMode = this.mode.kind;
    }
    if (
      next.end === this.scrollable.end &&
      next.start === this.scrollable.start
    ) {
      return;
    }
    this.scrollable = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private observe(element: HTMLElement) {
    if (this.observed.has(element)) {
      return;
    }
    this.resizes ??= new ResizeObserver(this.onResize);
    this.observed.add(element);
    this.resizes.observe(element);
  }

  private detachViewport() {
    const viewport = this.viewport;
    if (!viewport) {
      return;
    }
    viewport.removeEventListener("scroll", this.onScroll);
    viewport.removeEventListener("wheel", this.onWheel);
    viewport.removeEventListener("touchmove", this.onInput);
    viewport.removeEventListener("keydown", this.onKey);
    viewport.removeEventListener("pointerdown", this.onPointer);
    this.unregisterElement(viewport);
  }
}

/** An element's top in the viewport's scroll coordinates, in layout px. */
export function scrollTopOf(element: HTMLElement, viewport: HTMLElement) {
  return layoutTop(element) - layoutTop(viewport) - viewport.clientTop;
}

function layoutTop(element: HTMLElement) {
  let top = 0;
  for (
    let at: Element | null = element;
    at instanceof HTMLElement;
    at = at.offsetParent
  ) {
    top += at.offsetTop;
  }
  return top;
}

/** Whether an element between `target` and the viewport scrolls by `deltaY` itself. */
function scrollsInside(
  target: Element,
  viewport: HTMLElement,
  deltaY: number,
): boolean {
  for (
    let at: Element | null = target;
    at && at !== viewport;
    at = at.parentElement
  ) {
    if (at.scrollHeight <= at.clientHeight + 1) {
      continue;
    }
    const overflow = getComputedStyle(at).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") {
      continue;
    }
    if (
      deltaY < 0
        ? at.scrollTop > 0
        : at.scrollTop + at.clientHeight < at.scrollHeight - 1
    ) {
      return true;
    }
  }
  return false;
}
