import { useTabDeveloperMode } from "@/client/hooks/use-developer-mode";
import { FileOpenContext } from "@/client/components/file-open-context";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/client/components/ui/message-scroller";
import { StoppedLine } from "@/client/components/stopped-line";
import { LiveTranscriptSurface } from "@/client/components/transcript/live-surface";
import { Transcript } from "@/client/components/transcript/transcript";
import { useTranscriptFeed } from "@/client/components/transcript/use-transcript-feed";
import { Spinner } from "@/client/components/ui/spinner";
import { ChatSessionProvider } from "@/client/hooks/use-chat-session";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  type ChatId,
  isFolderPath,
  type StoreId,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { toast } from "@/client/lib/toast";

import { type OpenOptions, useWindow } from "./context";

const noop = () => {
  // A transcript with nothing to type into has nothing to retry.
};

/**
 * A task's transcript, on its own screen, read the way it unfolded and kept
 * at its end while the task works: the chat's conversation it carries on
 * from, then its own. Nothing to type into: the user talks to the chat,
 * which talks to the task, so this is how they look over its shoulder and
 * not a second conversation.
 */
export function ChildTranscript({
  chat,
  isWorking,
  sessionId,
  stoppedBy,
}: {
  chat: ChatId;
  isWorking: boolean;
  sessionId: StoreId.Session;
  /** Who stopped its last turn, which the transcript ends by saying. */
  stoppedBy?: "agent" | "app" | "person";
}) {
  const isDeveloperMode = useTabDeveloperMode();
  const feed = useTranscriptFeed({ id: chat, sessionId });

  const openFile = useOpenFileNamedByTask(chat);

  if (!feed.data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-5" />
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <MessageScrollerProvider
        autoScroll={isWorking}
        defaultScrollPosition="end"
        key={sessionId}
      >
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            className="@container/transcript"
            data-transcript
          >
            <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-2 p-4 pb-8 [--transcript-room:100cqi]">
              {/* Names the task and session for the links inside, so a page
                  the task names offers its browser as well as the user's. */}
              <ChatSessionProvider sessionId={sessionId} chatId={chat}>
                {/* Task paths are placed on the computer through the task's own layout before navigation. */}
                <FileOpenContext value={openFile}>
                  <LiveTranscriptSurface chat={chat}>
                    <Transcript
                      chatId={chat}
                      hasOlder={feed.data.hasOlder}
                      isDeveloperMode={isDeveloperMode}
                      isLoadingOlder={feed.isLoadingOlder}
                      isRunning={isWorking}
                      messages={feed.data.messages}
                      onLoadOlder={feed.loadOlder}
                      onRetry={noop}
                      sessionId={sessionId}
                    />
                  </LiveTranscriptSurface>
                </FileOpenContext>
              </ChatSessionProvider>
              {stoppedBy && (
                <StoppedLine>
                  {stoppedBy === "app"
                    ? "The app closed before this task finished."
                    : stoppedBy === "person"
                      ? "You stopped this task."
                      : "The chat stopped this task."}
                </StoppedLine>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
}

/**
 * Opens a file the task named, in the window's own terms.
 *
 * A reply writes the paths the task works in, which is the whole of what it
 * knows: `work/report.md` is its own folder, and a folder it was handed
 * wears the name it was mounted under there. The window addresses a tab by
 * where the file is on the computer, so the path is placed there through the
 * task's own layout before a tab is asked for it. A path the task cannot
 * reach opens nothing, and says so.
 */
function useOpenFileNamedByTask(chatId: ChatId) {
  const { openScreen } = useWindow();
  return (filePath: string, options?: OpenOptions) => {
    const isFolder = isFolderPath(filePath);
    const bare = isFolder ? filePath.slice(0, -1) : filePath;
    void (async () => {
      const [error, hostPaths] = await safe(
        rpcClient.workspace.chats.files.hostPaths.call({
          filePaths: [bare],
          chatId,
        }),
      );
      const hostPath = hostPaths?.[bare];
      if (error || !hostPath) {
        toast(`Nothing at “${filePath}”`, {
          description: "The task can’t reach this path.",
        });
        return;
      }
      openScreen(isFolder ? folderHref(hostPath) : fileHref(hostPath), options);
    })();
  };
}
