import { type LoadStage } from "@/client/lib/load-stage";
import { type BrowserTargetId } from "@instrument-org/workspace/client";

/** What each `<webview>` event a host listens to carries, as Electron fires it. */
export interface GuestEventMap {
  "did-fail-load": {
    errorCode: number;
    errorDescription: string;
    isMainFrame: boolean;
    validatedURL: string;
  };
  "did-navigate": { httpResponseCode: number; url: string };
  "did-navigate-in-page": { isMainFrame: boolean; url: string };
  "did-start-loading": object;
  "did-start-navigation": {
    isInPlace: boolean;
    isMainFrame: boolean;
    url: string;
  };
  "did-stop-loading": object;
  "dom-ready": object;
  "found-in-page": {
    result: {
      activeMatchOrdinal: number;
      finalUpdate: boolean;
      matches: number;
    };
  };
  "ipc-message": { args: unknown[]; channel: string };
  "page-favicon-updated": { favicons: string[] };
  "page-title-updated": { title: string };
  /** The pool's own, fired once `leaveHistory` has cleared the guest's history. */
  "history-left": object;
  /** The pool's own, fired after `setZoom`: Electron says nothing when a guest's zoom changes. */
  "zoom-set": object;
}

/**
 * A tab's guest once it can be driven, the one way anything outside the pool
 * reaches it: `getGuest` hands one back only after the guest is ready, and
 * every method is safe to call after that. A guest gone since answers as an
 * empty page (no address, no history) and ignores what it is asked to do.
 */
export interface GuestHandle {
  /**
   * Lets the page play sound, when the window has focus: for a page a person
   * opened from the window. A guest starts muted, since an agent may be
   * driving it with nobody watching.
   */
  allowSound(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  /** The page as it looks now, as a data URL; null when nothing could be taken. */
  capture(): Promise<null | string>;
  /** Forgets every entry but the one the guest is at. */
  clearHistory(): void;
  /**
   * Starts the guest's history at the page it is on, as the page it came from
   * at `url` becomes a step of its tab's own: what is behind is kept for the
   * guest that comes back there, as `as`. The guest has no steps meanwhile.
   */
  leaveHistory(left: { as: BrowserTargetId; url: string }): Promise<void>;
  find(text: string, options?: { findNext?: boolean; forward?: boolean }): void;
  /** Whether the page, or a frame in it, is still loading. */
  isLoading(): boolean;
  /** How far the page's load to a new document has come; `idle` when there is none. */
  loadStage(): LoadStage;
  /**
   * Loads `url`, settling once it has, and rejecting for a load that failed.
   * Only the window asks for one, for a person, so it calls `allowSound` first.
   */
  load(url: string): Promise<void>;
  on<K extends keyof GuestEventMap>(
    event: K,
    listener: (event: GuestEventMap[K]) => void,
  ): () => void;
  /** DevTools for the page, in a window of their own. */
  openDevTools(): void;
  /** The system's print dialog for the page. */
  print(): void;
  reload(options?: { ignoreCache?: boolean }): void;
  /** Runs `code` in the page and settles with what it returns. */
  run(code: string): Promise<unknown>;
  /** A message to the guest's preload, on a channel it listens on. */
  send(channel: string, ...args: unknown[]): void;
  setZoom(factor: number): void;
  /** A step through the page's own history; false when it has none that way. */
  step(direction: "back" | "forward"): boolean;
  /** Stops what the page is loading, leaving whatever it has drawn. */
  stop(): void;
  stopFind(
    action: "activateSelection" | "clearSelection" | "keepSelection",
  ): void;
  readonly targetId: BrowserTargetId;
  title(): string;
  /** The page's address; empty when it has none to give. */
  url(): string;
  readonly webContentsId: number;
  zoom(): number;
}
