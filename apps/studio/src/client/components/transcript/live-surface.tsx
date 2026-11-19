import { useShowChatFile } from "@/client/hooks/use-show-chat-file";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { paneOpenByGroupAtom, type WindowTab } from "@/client/atoms/window";
import {
  browserTargetOf,
  type BrowserTargetId,
  type ChatId,
  type StoreId,
} from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import {
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useChatTasks } from "../window/child-tasks-query";
import { WindowContext } from "../window/context";
import { taskHref } from "../window/tab-location";
import { useWindowTabs } from "../window/window-tabs";
import { type TranscriptSurface, TranscriptSurfaceContext } from "./surface";
import { LiveChatContext, useDrivenTab } from "./transcript-data";
import { usePagePicture } from "./use-page-picture";

type PageTab = Extract<WindowTab, { kind: "page" }>;

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
  const page = tab.url ?? tab.openedUrl;
  const url = usePagePicture(tab.id, targetId, page);
  // A picture already there when the card comes up is drawn at once.
  const [hasDrawn, setHasDrawn] = useState(url !== undefined);
  if (url === undefined && hasDrawn) {
    setHasDrawn(false);
  }
  // Each page's first picture fades in over the blank ground once it has
  // drawn; a later picture of the page replaces the one before in place. It
  // fills the width from the page's top and is cut off at the bottom, the way
  // a browser shows a page taller than its window.
  return url ? (
    <img
      alt=""
      className={cn(
        "block w-full transition-opacity duration-200",
        !hasDrawn && "opacity-0",
      )}
      draggable={false}
      onLoad={() => {
        setHasDrawn(true);
      }}
      src={url}
    />
  ) : null;
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
  const { select } = useWindowTabs();
  const setPaneOpenByGroup = useSetAtom(paneOpenByGroupAtom);
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  const stopCommand = useMutation(
    rpcClient.workspace.chats.backgroundProcesses.stop.mutationOptions(),
  );
  // Every chat's tasks are read once here, so each card shares one subscription.
  useChatTasks(chat);
  const latest = useRef({
    appWindow,
    chat,
    select,
    setPaneOpenByGroup,
    showChatFile,
    stop,
    stopCommand,
  });
  useLayoutEffect(() => {
    latest.current = {
      appWindow,
      chat,
      select,
      setPaneOpenByGroup,
      showChatFile,
      stop,
      stopCommand,
    };
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
    onShowPage: (tabId) => {
      // In front in its chat, with the chat's pane open, as the agent's own
      // `show` does.
      const now = latest.current;
      now.select(tabId);
      now.setPaneOpenByGroup((current) => ({ ...current, [now.chat]: true }));
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
