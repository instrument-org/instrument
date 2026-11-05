import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { useTaskBackgroundProcesses } from "@/client/hooks/use-task-background-processes";
import { useOpenFile } from "@/client/hooks/use-open-file";
import { useTargetAgentLastAt } from "@/client/hooks/use-target-agent-activity";
import { getGuest } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
import { type WindowTab } from "@/client/atoms/window";
import {
  browserTargetOf,
  type BrowserTargetId,
  type ChatId,
  isToolPart,
  type SessionMessagePart,
  type StepPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  use,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PageFavicon } from "../favicon";
import { useChatTasks, useChildTask } from "../window/child-tasks-query";
import { WindowContext } from "../window/context";
import { taskHref } from "../window/tab-location";
import { thumbnailKey } from "../window/use-page-thumbnail-housekeeping";
import { useWindowTabs } from "../window/window-tabs";
import {
  type TaskCardFacts,
  type TranscriptSurface,
  TranscriptSurfaceContext,
} from "./surface";
import { useTranscriptFeed } from "./use-transcript-feed";

/** How long after a page loads, moves, or renames itself its picture is taken. */
const CHANGE_SETTLE_MS = 500;

/**
 * How long after an agent's last command in a page its picture is taken: one
 * command of the agent's arrives as a burst, and the page redraws after.
 */
const AGENT_SETTLE_MS = 1000;

const LiveChatContext = createContext<ChatId | undefined>(undefined);

function useLiveChat(): ChatId {
  const chat = use(LiveChatContext);
  if (chat === undefined) {
    throw new Error("A live transcript needs its chat");
  }
  return chat;
}

function useStepPart(
  step: StepPart,
  isOpen: boolean,
): SessionMessagePart.ToolPart | undefined {
  const chat = useLiveChat();
  const whole = useQuery({
    ...rpcClient.workspace.message.live.whole.experimental_liveOptions({
      input: {
        id: chat,
        messageId: step.metadata.messageId,
        sessionId: step.metadata.sessionId,
      },
    }),
    enabled: isOpen,
  });
  const part = whole.data?.parts.find(
    (each) => each.metadata.id === step.metadata.id,
  );
  return part && isToolPart(part) ? part : undefined;
}

function useRunningCommands(): ReadonlySet<string> {
  const running = useTaskBackgroundProcesses(useLiveChat());
  return new Set(running.map((process) => process.id));
}

function useTaskFacts(id: StoreId.Session): TaskCardFacts | undefined {
  const task = useChildTask(useLiveChat(), id);
  return (
    task && {
      ...(task.standing && {
        ended: task.standing.summary ?? task.standing.line,
      }),
      failed: task.standing?.kind === "failed",
      ...(task.step && { step: task.step }),
      stoppable: task.stoppable,
      title: task.title,
      working: task.working,
    }
  );
}

function useTaskMessages(id: StoreId.Session, isWorking: boolean) {
  const chat = useLiveChat();
  const feed = useTranscriptFeed(
    { id: chat, isDeveloperMode: false, sessionId: id },
    { enabled: isWorking },
  );
  return isWorking ? (feed.data?.messages ?? []) : [];
}

type PageTab = Extract<WindowTab, { kind: "page" }>;

/**
 * The page a session's work is on: the tab among its own its agent drove last.
 * The picture follows it, retaken after each thing that changes the page.
 */
function LivePagePicture({ sessionId }: { sessionId: StoreId.Session }) {
  const chat = useLiveChat();
  const { allTabs } = useWindowTabs();
  const state = useQuery(
    rpcClient.workspace.chats.state.queryOptions({ input: { id: chat } }),
  );
  const held = new Set<string>(
    (state.data?.browserTabs ?? []).flatMap((tab) =>
      tab.driver === sessionId ? [tab.id] : [],
    ),
  );
  const pages = allTabs.filter(
    (tab): tab is PageTab => tab.kind === "page" && tab.group === chat,
  );
  const mine = pages.some((tab) => held.has(tab.id))
    ? pages.filter((tab) => held.has(tab.id))
    : pages;
  const driven = useQueries({
    combine: (results) => results.map((result) => result.data?.lastAt ?? 0),
    queries: mine.map((tab) =>
      rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions(
        { input: { targetId: browserTargetOf(tab.id) } },
      ),
    ),
  });
  const newest = mine.reduce<PageTab | undefined>(
    (best, tab, index) =>
      !best || (driven[index] ?? 0) >= (driven[mine.indexOf(best)] ?? 0)
        ? tab
        : best,
    undefined,
  );
  if (!newest) {
    return null;
  }
  return (
    <PageShot
      key={newest.id}
      tab={newest}
      targetId={browserTargetOf(newest.id)}
    />
  );
}

function PageShot({
  tab,
  targetId,
}: {
  tab: PageTab;
  targetId: BrowserTargetId;
}) {
  const url = usePagePicture(tab.id, targetId);
  if (url) {
    return (
      <img
        alt=""
        className="size-full object-cover object-top"
        draggable={false}
        src={url}
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center [&_img]:size-6 [&_svg]:size-6">
      <PageFavicon favicon={tab.favicon} url={tab.url ?? tab.openedUrl ?? ""} />
    </div>
  );
}

/**
 * A picture of the page, retaken shortly after it loads, moves or renames
 * itself and after each agent command in it. A newer capture finishing first
 * is never replaced by an older one.
 */
function usePagePicture(key: string, targetId: BrowserTargetId) {
  const queryClient = useQueryClient();
  const picture = useQuery({
    queryFn: () => rpcClient.browser.thumbnails.get.call({ key }),
    queryKey: thumbnailKey(key),
    staleTime: Infinity,
  });
  const isAttached = useBrowserTargets().has(targetId);
  const requested = useRef(0);
  const capture = useRef(() => {});
  useLayoutEffect(() => {
    capture.current = () => {
      // A guest not ready yet has nothing drawn to take.
      const webContentsId = getGuest(targetId)?.webContentsId;
      if (webContentsId === undefined) {
        return;
      }
      requested.current += 1;
      const mine = requested.current;
      void rpcClient.browser.thumbnails.capture
        .call({ key, webContentsId })
        .then((result) => {
          if (result.url && mine === requested.current) {
            queryClient.setQueryData(thumbnailKey(key), result);
          }
        })
        .catch(() => {
          // A missed picture keeps the last one; the next change takes another.
        });
    };
  });
  useEffect(() => {
    const guest = getGuest(targetId);
    if (!guest) {
      return;
    }
    let pending: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        capture.current();
      }, CHANGE_SETTLE_MS);
    };
    const stops = (
      [
        "did-stop-loading",
        "did-navigate",
        "did-navigate-in-page",
        "page-title-updated",
      ] as const
    ).map((event) => guest.on(event, soon));
    return () => {
      for (const stop of stops) {
        stop();
      }
      clearTimeout(pending);
    };
  }, [isAttached, targetId]);
  const agentAt = useTargetAgentLastAt(targetId);
  useEffect(() => {
    if (agentAt === undefined) {
      return;
    }
    const pending = setTimeout(() => {
      capture.current();
    }, AGENT_SETTLE_MS);
    return () => {
      clearTimeout(pending);
    };
  }, [agentAt]);
  return picture.data?.url ?? undefined;
}

/** Connects a transcript to the app: its records, its window and its pages. */
export function LiveTranscriptSurface({
  chat,
  children,
}: {
  chat: ChatId;
  children: ReactNode;
}) {
  const appWindow = useContext(WindowContext);
  const openFile = useOpenFile();
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  // Every chat's tasks are read once here, so each card shares one subscription.
  useChatTasks(chat);
  const latest = useRef({ appWindow, chat, openFile, stop });
  useLayoutEffect(() => {
    latest.current = { appWindow, chat, openFile, stop };
  });
  const [surface] = useState<TranscriptSurface>(() => ({
    onOpenFile: (path) => {
      latest.current.openFile({ hostPath: path });
    },
    onOpenTask: (id) => {
      latest.current.appWindow?.openScreen(taskHref(id, latest.current.chat));
    },
    onOpenUrl: (url) => {
      latest.current.appWindow?.browser?.openOrFocus(url, {
        group: latest.current.chat,
      });
    },
    onStopTask: (id) => {
      latest.current.stop.mutate({ id: latest.current.chat, sessionId: id });
    },
    PagePicture: LivePagePicture,
    useRunningCommands,
    useStepPart,
    useTaskFacts,
    useTaskMessages,
  }));
  const value = useMemo(() => surface, [surface]);
  return (
    <LiveChatContext value={chat}>
      <TranscriptSurfaceContext value={value}>
        {children}
      </TranscriptSurfaceContext>
    </LiveChatContext>
  );
}
