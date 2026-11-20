import { type WindowTab } from "@/client/atoms/window";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { getGuest } from "@/client/lib/browser-pool";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { rpcClient } from "@/client/rpc/client";
import { COMPUTER_ROOT } from "@/shared/computer-href";
import {
  distilledPageOf,
  distillPageScript,
} from "@instrument-org/shared/page-distill";
import { browserTargetOf } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { computerTabOf } from "./file-tabs";
import { useShell } from "./shell-context";
import { isChatTab, isNewChatTab } from "./tab-model";
import { useTabTitle } from "./tab-title";

/**
 * Ideas for what to ask about a set of tabs, the one in front first, from
 * the workspace's `ideas.ask` (ask-ideas.ts). Only while the set is on
 * screen: asked once it has stood still a while, never while `held` (the
 * corner is open: what it shows stays put), and at once by `ask`. Kept per
 * set, so coming back to one shows its ideas at once, and a set without
 * any shows none. A new tab showing counts as asking; the tabs changing
 * under a group are paced by the workspace, which may answer when to try
 * again. Nothing at all where new chats run on a connection with no fast
 * model, or with Show ideas off.
 */

/** How long a set of tabs stands still before ideas are asked for it: a new page or file in a group, or a new tab. */
const REST_MS = { "new-tab": 1000, tabs: 3000 } satisfies Record<
  Trigger,
  number
>;

/** What a page's walker may send, in characters, about 4 to a token: the tab in front, then the next three. */
const FRONT_CHARS = 12_000;
const NEXT_CHARS = 4000;
const READ_IN_FULL = 4;

/** Ideas already had, by the set of tabs they were for, for as long as the window runs. */
const known = new Map<string, readonly string[]>();

type Trigger = "new-tab" | "tabs";

/** Whether ideas can show at all: the person allows them, and new chats run on a connection with a fast model. */
export function useIdeasAvailable(): boolean {
  const shell = useShell();
  const { data: preferences } = useQuery(
    rpcClient.preferences.live.get.experimental_liveOptions(),
  );
  const { data: available } = useQuery(
    rpcClient.workspace.ideas.available.queryOptions({
      enabled: shell.defaultModelURI !== undefined,
      input: { modelURI: shell.defaultModelURI ?? "" },
    }),
  );
  return available === true && preferences?.showIdeas !== false;
}

/** Whether the connection new chats run on has a fast model, whatever the setting says. */
export function useIdeasConnection(): boolean {
  const shell = useShell();
  const { data: available } = useQuery(
    rpcClient.workspace.ideas.available.queryOptions({
      enabled: shell.defaultModelURI !== undefined,
      input: { modelURI: shell.defaultModelURI ?? "" },
    }),
  );
  return available === true;
}

export function useTabIdeas({
  held = false,
  isOn,
  tabs,
  trigger,
}: {
  held?: boolean;
  isOn: boolean;
  /** The tabs the ideas are about, the one in front first. */
  tabs: readonly WindowTab[];
  trigger: Trigger;
}): {
  ask: () => void;
  /** Whether ideas for these tabs are on their way, none having come yet. */
  isMaking: boolean;
  lines: readonly string[];
} {
  const shell = useShell();
  const isShown = useIsActiveTab();
  const titleOf = useTabTitle(shell.chatTitles);
  const key = `${trigger}\n${shell.defaultModelURI ?? ""}\n${tabs.map(identityOf).join("\n")}`;
  const [answered, setAnswered] = useState<{
    key: string;
    lines: readonly string[];
  }>();

  // The latest tabs, for an ask that reads them after the render it began in.
  const latest = useRef({ tabs, titleOf });
  useEffect(() => {
    latest.current = { tabs, titleOf };
  });

  /** Asks for this set's ideas, unless the set changed meanwhile: the lines, or when to try again. */
  const request = async (asked: boolean, isCurrent = () => true) => {
    const modelURI = shell.defaultModelURI;
    if (modelURI === undefined) {
      return;
    }
    const { tabs: now, titleOf: titled } = latest.current;
    const read = await Promise.all(
      now.map((tab, index) =>
        ideaTabOf(tab, titled(tab), {
          budget:
            index === 0 ? FRONT_CHARS : index < READ_IN_FULL ? NEXT_CHARS : 0,
        }),
      ),
    );
    if (!isCurrent()) {
      return;
    }
    const answer = await rpcClient.workspace.ideas.ask
      .call({ asked, key, modelURI, tabs: read, trigger })
      .catch(() => ({ lines: [] }));
    if ("lines" in answer) {
      known.set(key, answer.lines);
      setAnswered({ key, lines: answer.lines });
      return;
    }
    return answer.retryInMs;
  };

  useEffect(() => {
    if (!isOn || held || !isShown || shell.defaultModelURI === undefined) {
      return;
    }
    let isCurrent = true;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      void request(trigger === "new-tab", () => isCurrent).then((retryInMs) => {
        if (isCurrent && retryInMs !== undefined) {
          timer = setTimeout(attempt, retryInMs);
        }
      });
    };
    timer = setTimeout(attempt, REST_MS[trigger]);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
    // The key names the tabs and the model; the tabs' objects change on
    // every render of the window.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isOn, held, isShown]);

  const ask = () => {
    if (isOn) {
      void request(true);
    }
  };
  if (!isOn) {
    return { ask, isMaking: false, lines: [] };
  }
  const lines =
    known.get(key) ?? (answered?.key === key ? answered.lines : undefined);
  return {
    ask,
    isMaking:
      lines === undefined &&
      !held &&
      isShown &&
      shell.defaultModelURI !== undefined,
    lines: lines ?? [],
  };
}

/**
 * Steps the pace of the ideas the tabs set off back as the person moves to
 * this group, or opens a file in it while it is on screen.
 */
export function useIdeasPaceOnMoves(layout: {
  focused: 0 | 1;
  sides: { tabs: WindowTab[]; up?: string }[];
}) {
  const isShown = useIsActiveTab();
  const front = ideaTabsOf(layout)[0];
  const file = front && isFileTab(front) ? identityOf(front) : undefined;
  const last = useRef({ file, isShown });
  useEffect(() => {
    const before = last.current;
    last.current = { file, isShown };
    if (
      isShown &&
      (!before.isShown || (file !== undefined && file !== before.file))
    ) {
      void rpcClient.workspace.ideas.pace
        .call({ event: "moved" })
        .catch(() => undefined);
    }
  }, [file, isShown]);
}

/** Tells the workspace an idea was taken, which starts the pace over. */
export function noteIdeaTaken() {
  void rpcClient.workspace.ideas.pace
    .call({ event: "taken" })
    .catch(() => undefined);
}

/**
 * What makes a tab the same tab for the ideas: the tab itself and where it
 * is, a page's place in itself aside, so ideas for one tab never show for
 * another, and a tab gone somewhere else drops the ideas it had.
 */
function identityOf(tab: WindowTab): string {
  if (tab.kind !== "page") {
    return `${tab.id} ${tab.href}`;
  }
  const url = tab.url ?? tab.openedUrl;
  return `${tab.id} ${url === undefined ? "" : url.replace(/#.*$/, "")}`;
}

/** Whether a tab shows one file: a page at a file's address, or Files open at one. */
function isFileTab(tab: WindowTab): boolean {
  if (tab.kind === "page") {
    return hostPathOfFileUrl(tab.url ?? tab.openedUrl) !== undefined;
  }
  return computerTabOf(tab.href)?.file !== undefined;
}

/**
 * A tab as the workspace reads it for an idea: a page's text from its
 * walker, a file or folder by its path (read there), anything else by its
 * title alone.
 */
async function ideaTabOf(
  tab: WindowTab,
  title: string,
  { budget }: { budget: number },
) {
  if (tab.kind === "page") {
    const url = tab.url ?? tab.openedUrl;
    const filePath = hostPathOfFileUrl(url);
    if (filePath !== undefined) {
      return { path: filePath, title };
    }
    if (budget === 0) {
      return { title, ...(url ? { url } : {}) };
    }
    const guest = getGuest(browserTargetOf(tab.id));
    if (!guest) {
      return {
        title,
        unreadable: "the page isn't loaded",
        ...(url ? { url } : {}),
      };
    }
    try {
      const raw: unknown = await guest.run(distillPageScript(budget));
      return { title, ...(url ? { url } : {}), ...distilledPageOf(raw) };
    } catch {
      return {
        title,
        unreadable: "the page didn't answer",
        ...(url ? { url } : {}),
      };
    }
  }
  const computer = computerTabOf(tab.href);
  if (computer && computer.root !== COMPUTER_ROOT) {
    const folder = computer.path
      ? `${computer.root.replace(/\/$/, "")}/${computer.path}`
      : computer.root;
    return { path: computer.file ?? folder, title };
  }
  return { title, unreadable: "one of the app's own screens" };
}

/**
 * A group's tabs for its ideas, the one in front first: the tab up on the
 * side with the keyboard, then the other side's, then the rest in strip
 * order. A chat's tab and a new tab are not about anything, so they are left
 * out, as is `leaving`, the tab the ideas show in.
 */
export function ideaTabsOf(
  layout: { focused: 0 | 1; sides: { tabs: WindowTab[]; up?: string }[] },
  leaving?: string,
): WindowTab[] {
  const sides = [
    layout.sides[layout.focused],
    layout.sides[1 - layout.focused],
  ];
  const ups = sides.flatMap((side) =>
    side ? side.tabs.filter((tab) => tab.id === side.up) : [],
  );
  const rest = sides.flatMap((side) =>
    side ? side.tabs.filter((tab) => tab.id !== side.up) : [],
  );
  return [...ups, ...rest].filter(
    (tab) => tab.id !== leaving && !isChatTab(tab) && !isNewChatTab(tab),
  );
}

/**
 * What a new chat's ideas are made from: the pages, files and folders in
 * its group, the one in front first, as {@link ideaTabsOf} orders them.
 * The app's own screens are about nothing to have an idea about.
 */
export function ideaSourcesOf(
  layout: { focused: 0 | 1; sides: { tabs: WindowTab[]; up?: string }[] },
  leaving: string,
): WindowTab[] {
  return ideaTabsOf(layout, leaving).filter((tab) => {
    if (tab.kind === "page") {
      return (tab.url ?? tab.openedUrl) !== undefined;
    }
    const computer = computerTabOf(tab.href);
    return computer !== undefined && computer.root !== COMPUTER_ROOT;
  });
}
