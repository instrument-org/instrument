import {
  type HiddenBy,
  type HistoryActor,
  type HistoryStore,
  type HistoryTransition,
} from "./history-store";

/**
 * Turns one tab's navigation events into history, the way Chromium's
 * `HistoryTabHelper` does, from what Electron says about the tab. Pure state
 * over the events it is fed, so the decisions are tested against event
 * sequences without a browser; `manager.ts` feeds it a guest's events.
 *
 * Electron reports neither Chromium's "did replace entry" nor its page
 * transition, so both are derived from the tab's navigation list, read just
 * before each commit and again after it settles (`classifyCommit`):
 *
 * - An entry put in place of the one the tab stood on (the list's length and
 *   the tab's place in it unchanged, at a new address) is a replacement:
 *   `location.replace`, a `<meta refresh>`, `history.replaceState`. The page
 *   replaced was only a hop on the way, a client redirect, so its visit is
 *   hidden, and the new visit is marked as reached by one.
 * - The same entry at the same address is a reload, which adds no visit.
 * - The tab standing on another entry it already had, at that entry's address,
 *   with the list's length unchanged, is a step back or forward.
 * - Anything else is a new entry.
 *
 * A server's 3xx hops never commit: Chromium follows them inside one
 * navigation (`did-redirect-navigation`) and commits only where they end, so
 * they never reach history.
 */

/** What a tab's navigation list looked like at a moment. */
export interface NavigationSnapshot {
  index: number;
  length: number;
  urls: readonly string[];
}

export type CommitKind = "history-step" | "new" | "reload" | "replace";

/** How long after a page finishes loading its title still counts as the page's, Chromium's rule. */
export const TITLE_WINDOW_MS = 5000;
/** How many titles one navigation may set, Chromium's rule, so a page cycling its title cannot keep rewriting history. */
export const TITLE_CHANGES_MAX = 10;

/** See the module comment. */
export function classifyCommit(
  before: NavigationSnapshot | undefined,
  after: NavigationSnapshot,
  url: string,
): CommitKind {
  if (before === undefined) {
    return "new";
  }
  if (after.index === before.index && after.length === before.length) {
    return before.urls[before.index] === url ? "reload" : "replace";
  }
  if (after.length === before.length && before.urls[after.index] === url) {
    return "history-step";
  }
  return "new";
}

/**
 * Whether a committed address belongs in history: only pages on the web,
 * where Chromium's own `CanAddURL` also leaves out the browser's internal
 * schemes. A local file has its own place in Files and Recents.
 */
export function isRecordable(url: string): boolean {
  const protocol = URL.parse(url)?.protocol;
  return protocol === "http:" || protocol === "https:";
}

/** What the recorder asks of the rest of the app, as functions so a test can answer them. */
export interface RecorderDeps {
  /**
   * Who drove a navigation that started at `startedAt`: the agent when one
   * sent the tab a command since shortly before then, the person otherwise.
   */
  actorSince: (startedAt: number) => HistoryActor;
  now: () => number;
  /** The slug of a pending app sign-in whose authorization page is at this address. */
  signInAt: (url: string) => string | undefined;
  /** Whether that sign-in is still waiting for its callback. */
  signInPending: (slug: string) => boolean;
  sink: Pick<
    HistoryStore,
    "addVisit" | "hideVisit" | "setFavicon" | "setTitle"
  >;
  /** Whether the app reopened this page to restore a tab, consuming the mark; a restore is no new visit. */
  takeRestored: (urls: readonly string[]) => boolean;
  /** Whether the person typed this page in the address field or opened it from a bookmark, consuming the mark. */
  takeTyped: (urls: readonly string[]) => boolean;
}

interface Start {
  at: number;
  /** Every address the navigation has been at, through server redirects; the last is where it is now. */
  chain: string[];
  isSignIn: boolean;
}

interface Current {
  /** The visits a client redirect chain has gone through, ending at this one, which share its title. */
  chain: number[];
  url: string;
  visitId: number;
}

export type TabRecorder = ReturnType<typeof createTabRecorder>;

export function createTabRecorder(deps: RecorderDeps) {
  let snapshot: NavigationSnapshot | undefined;
  /** Cross-document main-frame navigations started and not yet committed, oldest first. */
  let starts: Start[] = [];
  let current: Current | undefined;
  /** The app sign-in this tab was opened for, while it waits. */
  let signIn: string | undefined;
  /** The document's own title, as it last set it. */
  let documentTitle: string | undefined;
  const titleWindow = { changes: 0, loading: false, stoppedAt: 0 };

  const inSignIn = () => {
    if (signIn !== undefined && !deps.signInPending(signIn)) {
      signIn = undefined;
    }
    return signIn !== undefined;
  };

  const record = ({
    isSameDocument,
    start,
    status,
    url,
    after,
  }: {
    after: NavigationSnapshot;
    isSameDocument: boolean;
    start: Start | undefined;
    status?: number | undefined;
    url: string;
  }) => {
    const kind = classifyCommit(snapshot, after, url);
    if (!isRecordable(url)) {
      current = undefined;
      return;
    }
    if (kind === "reload") {
      return;
    }
    const urls = [...(start?.chain ?? []), url];
    if (!isSameDocument && deps.takeRestored(urls)) {
      current = undefined;
      return;
    }
    const actor = deps.actorSince(start?.at ?? deps.now());
    const typed = actor === "user" && deps.takeTyped(urls);
    const hiddenBy: HiddenBy | undefined =
      (start?.isSignIn ?? inSignIn())
        ? "sign-in"
        : status !== undefined && status >= 400
          ? "error"
          : undefined;
    const replaced = kind === "replace" ? current : undefined;
    if (replaced) {
      deps.sink.hideVisit(replaced.visitId, "redirect");
    }
    const transition: HistoryTransition =
      kind === "history-step" ? "back_forward" : typed ? "typed" : "link";
    const visitId = deps.sink.addVisit({
      actor,
      at: deps.now(),
      ...(current ? { fromVisit: current.visitId } : {}),
      ...(hiddenBy ? { hiddenBy } : {}),
      ...(replaced ? { isClientRedirect: true } : {}),
      ...(status !== undefined && status > 0 ? { status } : {}),
      transition,
      url,
    });
    current = {
      chain: [...(replaced?.chain ?? []), visitId],
      url,
      visitId,
    };
  };

  return {
    /** The page set its title, `explicit` when from a `<title>` rather than made up from the address. */
    title(title: string, explicit: boolean) {
      if (!explicit || title === "") {
        return;
      }
      documentTitle = title;
      if (!current) {
        return;
      }
      const inWindow =
        titleWindow.loading ||
        deps.now() - titleWindow.stoppedAt <= TITLE_WINDOW_MS;
      if (!inWindow || titleWindow.changes >= TITLE_CHANGES_MAX) {
        return;
      }
      titleWindow.changes += 1;
      deps.sink.setTitle(current.chain, title);
    },

    /**
     * A main-frame document committed. The title is never read here: a new
     * document has not set one yet, so what the tab says at this moment is
     * the address or the last page's title. It comes in `title` once the
     * page sets it.
     */
    commit({
      after,
      status,
      url,
    }: {
      after: NavigationSnapshot;
      status?: number | undefined;
      url: string;
    }) {
      const index = starts.findLastIndex((start) => start.chain.at(-1) === url);
      const start = index === -1 ? undefined : starts[index];
      starts = index === -1 ? starts : starts.slice(index + 1);
      record({ after, isSameDocument: false, start, status, url });
      documentTitle = undefined;
      titleWindow.changes = 0;
      titleWindow.loading = true;
    },

    /**
     * The main frame moved within its document: a fragment, `pushState`,
     * `replaceState`. One that stays at the same address (a `replaceState`
     * keeping it, to store state) is nothing to record. The document keeps
     * the title it had, so the new visit starts with it; a title the page
     * sets afterwards follows.
     */
    commitSameDocument({
      after,
      url,
    }: {
      after: NavigationSnapshot;
      url: string;
    }) {
      if (current?.url === url) {
        return;
      }
      record({ after, isSameDocument: true, start: undefined, url });
      titleWindow.changes = 0;
      titleWindow.loading = false;
      titleWindow.stoppedAt = deps.now();
      if (current && documentTitle !== undefined) {
        deps.sink.setTitle([current.visitId], documentTitle);
      }
    },

    /** A main-frame load failed; a page that committed and then failed is kept out like an error status. */
    failed(url: string) {
      if (current?.url === url) {
        deps.sink.hideVisit(current.visitId, "error");
      }
    },

    favicon(favicon: string) {
      if (current) {
        deps.sink.setFavicon(current.url, favicon);
      }
    },

    /** A server redirect moved a started main-frame navigation on. */
    redirect(url: string) {
      starts.at(-1)?.chain.push(url);
    },

    /** The tab's navigation list as it settled after a commit, which the next commit is compared against. */
    settle(after: NavigationSnapshot) {
      snapshot = after;
    },

    /** A cross-document main-frame navigation started. */
    start(url: string) {
      const slug = deps.signInAt(url);
      if (slug !== undefined) {
        signIn = slug;
      }
      starts = [
        ...starts.slice(-4),
        { at: deps.now(), chain: [url], isSignIn: inSignIn() },
      ];
    },

    stoppedLoading() {
      titleWindow.loading = false;
      titleWindow.stoppedAt = deps.now();
    },
  };
}
