import { fileHref, folderHref } from "@/shared/computer-href";

/**
 * What something outside the window asks it to put up: a screen by its
 * route, from a link, a file handed to the app, which the window places
 * itself, or a new chat's draft with the words a link brought.
 */
export type AppWindowAsk =
  | { hostPath: string; type: "openFile" }
  | { href: string; type: "openScreen" }
  /**
   * A file a link named that is not there, said by its name, with the folder
   * it was in opened when that folder is there.
   */
  | { folder?: string; name: string; type: "missingFile" }
  /** How many paths past its cap a link to several files left unopened, said. */
  | { count: number; type: "notOpened" }
  /**
   * A hosted page a link named that could not be opened, said by its host:
   * the host did not hand it over, or no copy could be kept in Downloads.
   */
  | { host: string; type: "pageNotOpened"; why: "noAnswer" | "notKept" }
  /**
   * A link from outside that is not one the app knows, said in fixed words:
   * it carries nothing of the link, whose text goes only to the log.
   */
  | { type: "linkNotOpened" }
  | { project?: string; type: "newChat"; words: string }
  /** New Chat pressed with no window open, for the window it opens. */
  | { type: "openNewChat" };

/**
 * The address of the tab that shows what an ask puts up, for finding the
 * window with a tab already showing it; undefined for an ask that makes
 * something new.
 */
export function tabHrefOfAsk(ask: AppWindowAsk): string | undefined {
  switch (ask.type) {
    case "missingFile": {
      return ask.folder === undefined ? undefined : folderHref(ask.folder);
    }
    case "openFile": {
      return fileHref(ask.hostPath);
    }
    case "openScreen": {
      return ask.href;
    }
    case "linkNotOpened":
    case "newChat":
    case "notOpened":
    case "openNewChat":
    case "pageNotOpened": {
      return undefined;
    }
  }
}

/**
 * Where asks from outside the window wait until it can take them: while its
 * page is loading, which cannot hear the command stream yet, and while
 * `isHeld` says the window is not the person's to use (setup is up). They go
 * out in order, through `deliver`, once both are past: the page asks for what
 * waited when it is up (`take`), and `release` sends what waited when the
 * hold lifts.
 */
export function createAppWindowAsks({
  deliver,
  isHeld,
}: {
  deliver: (ask: AppWindowAsk) => void;
  isHeld: () => boolean;
}) {
  let pending: AppWindowAsk[] = [];
  // Whether the window's page has taken what waited for it, and so is
  // listening for asks as they come. A window that exists is not enough: its
  // page may still be loading, or reloading.
  let isTaking = false;

  const handOver = () => {
    const asks = pending;
    pending = [];
    return asks;
  };

  return {
    ask(ask: AppWindowAsk) {
      if (isTaking && !isHeld()) {
        deliver(ask);
        return;
      }
      pending.push(ask);
    },
    /** The window lifted its hold: what waited goes to a page listening. */
    release() {
      if (!isTaking || isHeld()) {
        return;
      }
      for (const ask of handOver()) {
        deliver(ask);
      }
    },
    /** The page went away or is loading afresh, and is not listening. */
    stopTaking() {
      isTaking = false;
    },
    /** The page is up and listening: what waited for it, unless held. */
    take(): AppWindowAsk[] {
      isTaking = true;
      return isHeld() ? [] : handOver();
    },
    /** What waits, which a link from outside is let go past a few of. */
    get waiting(): readonly AppWindowAsk[] {
      return pending;
    },
  };
}
