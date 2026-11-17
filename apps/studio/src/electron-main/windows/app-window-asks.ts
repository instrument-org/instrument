import { fileHref, folderHref } from "@/shared/computer-href";

/**
 * What something outside the window asks it to put up: a screen by its
 * route, from a link, a file handed to the app, which the window places
 * itself, or a new chat's draft with the words a link brought.
 */
export type AppWindowAsk =
  | { hostPath: string; type: "openFile" }
  /**
   * One thing by its address: a tab already showing it (`tabIdentityOf`) in
   * any group the window lists comes up and lights, and otherwise it opens
   * as a tab group of its own. A chat comes up where it is open.
   */
  | { href: string; type: "openScreen" }
  /**
   * A new tab group with a tab at each address, in the order given, all on
   * one side with the first up: what several files, folders and pages handed
   * over together from outside open as (`outsideOpensOf`), even where a tab
   * already shows one of them.
   */
  | { hrefs: string[]; type: "openGroup" }
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
 * something new or only says something.
 */
export function tabHrefOfAsk(ask: AppWindowAsk): string | undefined {
  switch (ask.type) {
    case "openFile": {
      return fileHref(ask.hostPath);
    }
    case "openScreen": {
      return ask.href;
    }
    case "linkNotOpened":
    case "missingFile":
    case "newChat":
    case "notOpened":
    case "openGroup":
    case "openNewChat":
    case "pageNotOpened": {
      return undefined;
    }
  }
}

/** Whether an address is one of Files: a folder, or a file in its folder. */
const isFilesHref = (href: string) => /^\/files(?:[?#]|$)/.test(href);

/**
 * What one hand-over from outside (a link, files from the Finder or a launch)
 * asks of the window. Several files, folders and pages are one new tab
 * group, a tab each in the order given, standing where the first of them
 * stood among the asks. One alone is a screen (`openScreen`), which a tab
 * already showing it brings forward. A missing file's folder counts among
 * them, and its ask stays to say the file is gone. Everything else stays as
 * it was: a chat is never in the group, and comes forward where it is open.
 */
export function outsideOpensOf(asked: readonly AppWindowAsk[]): AppWindowAsk[] {
  const hrefs: string[] = [];
  const group: AppWindowAsk = { hrefs, type: "openGroup" };
  const opens: AppWindowAsk[] = [];
  const intoGroup = (href: string) => {
    if (hrefs.length === 0) {
      opens.push(group);
    }
    // A missing file's folder may be named in the same hand-over too.
    if (!hrefs.includes(href)) {
      hrefs.push(href);
    }
  };
  for (const ask of asked) {
    if (ask.type === "openFile") {
      intoGroup(fileHref(ask.hostPath));
    } else if (ask.type === "openScreen" && isFilesHref(ask.href)) {
      intoGroup(ask.href);
    } else if (ask.type === "openGroup") {
      for (const href of ask.hrefs) {
        intoGroup(href);
      }
    } else {
      if (ask.type === "missingFile" && ask.folder !== undefined) {
        intoGroup(folderHref(ask.folder));
      }
      opens.push(ask);
    }
  }
  const [only] = hrefs;
  return hrefs.length === 1 && only !== undefined
    ? opens.map((ask) =>
        ask === group ? { href: only, type: "openScreen" } : ask,
      )
    : opens;
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
