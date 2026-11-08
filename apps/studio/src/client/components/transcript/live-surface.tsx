import { useHostPaths } from "@/client/hooks/use-host-paths";
import { useChatCommands } from "@/client/hooks/use-task-background-processes";
import { useShowChatFile } from "@/client/hooks/use-show-chat-file";
import { cn } from "@/client/lib/utils";
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
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  use,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PageFavicon } from "../favicon";
import { useChatTasks } from "../window/child-tasks-query";
import { WindowContext } from "../window/context";
import { taskHref } from "../window/tab-location";
import { useWindowTabs } from "../window/window-tabs";
import {
  type TaskCardFacts,
  type TranscriptSurface,
  TranscriptSurfaceContext,
} from "./surface";
import { taskCardFacts } from "./task-card-facts";
import { usePagePicture } from "./use-page-picture";
import { useTranscriptFeed } from "./use-transcript-feed";

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
): SessionMessagePart.ReasoningPart | SessionMessagePart.ToolPart | undefined {
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
  return part && (isToolPart(part) || part.type === "reasoning")
    ? part
    : undefined;
}

function useChatHostPaths(paths: readonly string[]) {
  return useHostPaths(useLiveChat(), paths);
}

function useCommands() {
  return useChatCommands(useLiveChat());
}

function useTaskFacts(
  id: StoreId.Session,
  from?: StoreId.Message,
): TaskCardFacts | undefined {
  const tasks = useChatTasks(useLiveChat());
  const task = tasks.data?.find((each) => each.id === id);
  if (tasks.data && !task) {
    return {
      failed: false,
      gone: true,
      stoppable: false,
      title: "Task",
      working: false,
    };
  }
  return task && taskCardFacts(task, from);
}

function useTaskMessages(id: StoreId.Session, isWorking: boolean) {
  const chat = useLiveChat();
  const feed = useTranscriptFeed(
    { id: chat, sessionId: id },
    { enabled: isWorking },
  );
  return isWorking ? (feed.data?.messages ?? []) : [];
}

type PageTab = Extract<WindowTab, { kind: "page" }>;

/**
 * The page a session's work is on: the chat's tab an agent drove last, since
 * every session of a chat drives every tab of it. Nothing is read while
 * `sessionId` is absent.
 */
function useDrivenTab(
  sessionId: StoreId.Session | undefined,
): PageTab | undefined {
  const chat = useLiveChat();
  const { allTabs } = useWindowTabs();
  const mine =
    sessionId === undefined
      ? []
      : allTabs.filter(
          (tab): tab is PageTab => tab.kind === "page" && tab.group === chat,
        );
  const driven = useQueries({
    combine: (results) => results.map((result) => result.data?.lastAt ?? 0),
    queries: mine.map((tab) =>
      rpcClient.workspace.browser.events.agentActivity.experimental_liveOptions(
        { input: { targetId: browserTargetOf(tab.id) } },
      ),
    ),
  });
  return mine.reduce<PageTab | undefined>(
    (best, tab, index) =>
      !best || (driven[index] ?? 0) >= (driven[mine.indexOf(best)] ?? 0)
        ? tab
        : best,
    undefined,
  );
}

/** What the page a session's work is on says it is, as its tab last heard. */
function useDrivenPage(sessionId: StoreId.Session | undefined) {
  const tab = useDrivenTab(sessionId);
  const url = tab?.url ?? tab?.openedUrl;
  return (
    tab && {
      ...(tab.title && { title: tab.title }),
      ...(url && { url }),
    }
  );
}

/** The driven page's picture, retaken after each thing that changes the page. */
function LivePagePicture({ sessionId }: { sessionId: StoreId.Session }) {
  const newest = useDrivenTab(sessionId);
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
  const [hasDrawn, setHasDrawn] = useState(false);
  // The page's icon, which its first picture fades in over once it has drawn;
  // a later picture replaces the one before in place.
  return (
    <>
      <div className="flex h-full items-center justify-center [&_img]:size-6 [&_svg]:size-6">
        <PageFavicon
          favicon={tab.favicon}
          url={tab.url ?? tab.openedUrl ?? ""}
        />
      </div>
      {url && (
        <img
          alt=""
          className={cn(
            "absolute inset-0 size-full object-cover object-top transition-opacity duration-200",
            !hasDrawn && "opacity-0",
          )}
          draggable={false}
          onLoad={() => {
            setHasDrawn(true);
          }}
          src={url}
        />
      )}
    </>
  );
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
  const showChatFile = useShowChatFile();
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  const stopCommand = useMutation(
    rpcClient.workspace.chats.backgroundProcesses.stop.mutationOptions(),
  );
  // Every chat's tasks are read once here, so each card shares one subscription.
  useChatTasks(chat);
  const latest = useRef({ appWindow, chat, showChatFile, stop, stopCommand });
  useLayoutEffect(() => {
    latest.current = { appWindow, chat, showChatFile, stop, stopCommand };
  });
  const [surface] = useState<TranscriptSurface>(() => ({
    onOpenFile: (path) => {
      latest.current.showChatFile(path);
    },
    onOpenTask: (id) => {
      latest.current.appWindow?.openScreen(taskHref(id, latest.current.chat));
    },
    onOpenUrl: (url) => {
      latest.current.appWindow?.openPage(url, { show: true });
    },
    onStopCommand: ({ id, sessionId }) => {
      latest.current.stopCommand.mutate({
        id: latest.current.chat,
        processId: id,
        sessionId,
      });
    },
    onStopTask: (id) => {
      latest.current.stop.mutate({ id: latest.current.chat, sessionId: id });
    },
    PagePicture: LivePagePicture,
    useDrivenPage,
    useHostPaths: useChatHostPaths,
    useCommands,
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
