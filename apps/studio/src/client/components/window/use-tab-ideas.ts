import { type WindowTab } from "@/client/atoms/window";
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
import { useEffect, useState } from "react";

import { computerTabOf } from "./file-tabs";
import { useShell } from "./shell-context";
import { isChatTab, isNewChatTab } from "./tab-model";
import { useTabTitle } from "./tab-title";

/**
 * Ideas for what to ask about a set of tabs, the one in front first, from
 * the workspace's `ideas.ask` (ask-ideas.ts). Asked once the set has stood
 * still a moment, never while `held` (the corner is open: what it shows
 * stays put), and kept per set, so coming back to one shows its ideas at
 * once. Nothing at all where new chats run on a connection with no fast
 * model, or with Show ideas off.
 */

/** How long a set of tabs stands still before ideas are asked for it. */
const DWELL_MS = 1000;

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
}): { isWaiting: boolean; lines: readonly string[] } {
  const shell = useShell();
  const titleOf = useTabTitle(shell.chatTitles);
  const key = `${trigger}\n${shell.defaultModelURI ?? ""}\n${tabs.map(identityOf).join("\n")}`;
  const [answered, setAnswered] = useState<{
    key: string;
    lines: readonly string[];
  }>();
  const cached = known.get(key);

  useEffect(() => {
    const modelURI = shell.defaultModelURI;
    if (!isOn || held || known.has(key) || modelURI === undefined) {
      return;
    }
    let isCurrent = true;
    const timer = setTimeout(() => {
      void (async () => {
        const read = await Promise.all(
          tabs.map((tab, index) =>
            ideaTabOf(tab, titleOf(tab), {
              budget:
                index === 0
                  ? FRONT_CHARS
                  : index < READ_IN_FULL
                    ? NEXT_CHARS
                    : 0,
            }),
          ),
        );
        if (!isCurrent) {
          return;
        }
        const lines = await rpcClient.workspace.ideas.ask
          .call({
            key,
            modelURI,
            tabs: read,
            trigger,
          })
          .catch(() => []);
        known.set(key, lines);
        if (isCurrent) {
          setAnswered({ key, lines });
        }
      })();
    }, DWELL_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
    // The key names the tabs and the model; the tabs' objects change on
    // every render of the window.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, isOn, held]);

  if (!isOn) {
    return { isWaiting: false, lines: [] };
  }
  const lines = cached ?? (answered?.key === key ? answered.lines : undefined);
  return { isWaiting: lines === undefined, lines: lines ?? [] };
}

/** What makes a tab the same tab for the ideas: where it is. */
function identityOf(tab: WindowTab): string {
  return tab.kind === "page" ? (tab.url ?? tab.openedUrl ?? tab.id) : tab.href;
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
