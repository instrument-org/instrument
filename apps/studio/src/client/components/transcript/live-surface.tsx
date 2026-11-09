import { useShowChatFile } from "@/client/hooks/use-show-chat-file";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type WindowTab } from "@/client/atoms/window";
import {
  browserTargetOf,
  type BrowserTargetId,
  type ChatId,
  type StoreId,
} from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";
import {
  type ReactNode,
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
