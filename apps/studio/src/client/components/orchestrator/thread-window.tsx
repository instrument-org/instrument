import { type WindowTab } from "@/client/atoms/orchestrator";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { useBrowserAgentActivity } from "@/client/hooks/use-browser-agent-activity";
import { useTargetAgentActivity } from "@/client/hooks/use-target-agent-activity";
import { cn } from "@/client/lib/utils";
import {
  encodeBrowserTargetId,
  type SessionMessageDataPart,
  StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { XIcon } from "@phosphor-icons/react/X";
import { motion } from "motion/react";
import { type ReactNode, useContext } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { TabIcon } from "./browser-tabs";
import {
  COMPOSE_BAR_WIDTH,
  COMPOSE_MOTION,
  THREAD_WINDOW_WIDTH,
} from "./compose-layout";
import { WindowButton } from "./compose-window";
import { OrchestratorContext, useOrchestrator } from "./context";
import { pageTabTitle } from "./file-tabs";
import { screenPresentation } from "./screen-presentation";
import { ThreadScreen } from "./thread-stage";
import { ThreadTitle } from "./thread-title";
import { type Thread } from "./threads";
import { useThreadRename } from "./use-thread-rename";
import { useWindowTabs } from "./window-tabs";

/** A thread's small view's height, in layout px: enough of the conversation to follow a reply arriving. */
const THREAD_WINDOW_HEIGHT = 560;

/**
 * A thread put down: a dark bar along the window's foot with its title and
 * the pulse while it works, brought back up by a press, taken down by its
 * cross. The thread itself is untouched by either.
 */
export function ThreadBar({
  onClose,
  onOpen,
  right,
  thread,
}: {
  onClose: () => void;
  onOpen: () => void;
  /** Where the bar stands along the foot, in layout px from the right edge. */
  right: number;
  thread: Thread | undefined;
}) {
  const isWorking = thread?.state === "working";
  return (
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
      className="pointer-events-auto absolute bottom-0 z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl-soft dark:bg-gray-700"
      data-slot="thread-bar"
      exit={{ opacity: 0, y: 36 }}
      initial={{ opacity: 0, right, y: 36 }}
      style={{ width: COMPOSE_BAR_WIDTH }}
      transition={COMPOSE_MOTION}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left hover:bg-white/8"
        onClick={onOpen}
        type="button"
      >
        {isWorking ? (
          <PlanningDotIcon className="size-3.5" />
        ) : (
          <ChatsCircleIcon className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {thread?.title ?? "Thread"}
        </span>
      </button>
      <button
        aria-label="Close"
        className="grid h-full w-8 shrink-0 place-items-center text-white/80 hover:bg-white/8 hover:text-white"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </motion.div>
  );
}

/**
 * A thread's small view: the conversation in a window docked to the row's
 * bottom-right corner, over whatever place the window stands in, the way a
 * video keeps playing in its small window over the page that owns it. Its
 * head carries the pulse while the thread works, the thread's title, which
 * renames it when clicked, and the window's three buttons; under the head a picture of the thread's tabs
 * as they stand in its pane, to look at and to go to, never to manage; and
 * under that the thread's own transcript, work line and reply box, mounted
 * here and nowhere else while the thread floats.
 *
 * Everything that leaves the corner goes to Chat: expand, a tab pressed in
 * the picture, and anything the conversation opens to be shown. The pages
 * the agent opens land in the thread's own group behind the window, never
 * in the place's tabs.
 */
export function ThreadWindow({
  arrives,
  childTitles,
  onClose,
  onExpand,
  onMinimize,
  onPressTab,
  right,
  sendContext,
  sessionId,
  thread,
  width = THREAD_WINDOW_WIDTH,
}: {
  /** Whether the window arrives with a motion: a draft becoming the thread is the same window, so it does not. */
  arrives: boolean;
  childTitles: Map<TaskId, string>;
  onClose: () => void;
  /** Lands in Chat with the thread open whole; the window goes. */
  onExpand: () => void;
  onMinimize: () => void;
  /** Lands in Chat with the thread open and this tab in front of its pane. */
  onPressTab: (tabId: string) => void;
  /** Where the window stands along the foot, in layout px from the right edge. */
  right: number;
  sendContext: () => Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  >;
  sessionId: StoreId.Session;
  thread: Thread | undefined;
  /** The window's width, narrower than its own on a row with less room. */
  width?: number;
}) {
  const orchestrator = useOrchestrator();
  const openFile = useContext(FileOpenContext);
  const { allTabs } = useWindowTabs();
  const tabs = allTabs.filter((tab) => tab.group === sessionId);
  const isWorking = thread?.state === "working";
  const rename = useThreadRename(thread);
  return (
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
      // On the page's ground rather than the card's: the conversation is
      // drawn for that ground, its bubbles on the card's and its fades from
      // the page's, and on a card both go missing.
      // An opaque edge, and the shadow ramp without its own hairline: the
      // small view is drawn over the pane, over a page guest, and under a
      // draft window, and a see-through edge takes the color of whatever it
      // lands on and doubles wherever two of them cross.
      className="pointer-events-auto absolute bottom-0 z-40 flex max-h-[calc(100%-1rem)] flex-col overflow-hidden rounded-t-2xl bg-background text-foreground shadow-xl-soft ring-1 ring-gray-300 dark:ring-gray-600"
      data-slot="thread-window"
      exit={{ opacity: 0, y: 24 }}
      initial={arrives ? { opacity: 0, right, y: 24 } : false}
      style={{ height: THREAD_WINDOW_HEIGHT, width }}
      transition={COMPOSE_MOTION}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 select-none">
        {isWorking ? (
          <PlanningDotIcon className="size-4" />
        ) : (
          <ChatsCircleIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        {thread ? (
          <h2 className="flex min-w-0 flex-1">
            <ThreadTitle
              className="text-[13px] font-semibold"
              grow
              rename={rename}
              title={thread.title}
            />
          </h2>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            Thread
          </h2>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          <WindowButton label="Minimize" onClick={onMinimize}>
            <MinusIcon className="size-4" />
          </WindowButton>
          <WindowButton label="Open in Chat" onClick={onExpand}>
            <ArrowsOutSimpleIcon className="size-4" />
          </WindowButton>
          <WindowButton label="Close" onClick={onClose}>
            <XIcon className="size-4" />
          </WindowButton>
        </div>
      </div>
      {tabs.length > 0 && (
        <TabPicture
          childTitles={childTitles}
          onPress={onPressTab}
          tabs={tabs}
        />
      )}
      {/* `select-text`: the window's shell is chrome and turns selection off; the chat is text. The sizes are the chat column's. */}
      <div className="relative min-h-0 flex-1 select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]">
        {/* What the conversation asks to have shown leaves the corner: the
            thread lands in Chat whole, and the thing opens in its pane. What
            it opens behind (an agent's page arriving) stays behind. */}
        <OrchestratorContext
          value={{
            ...orchestrator,
            openPage: (url, options) => {
              if (options?.show) {
                onExpand();
              }
              orchestrator.openPage(url, options);
            },
            openPath: (path, options) => {
              if (options?.show) {
                onExpand();
              }
              orchestrator.openPath(path, options);
            },
            openScreen: (href, options) => {
              if (options?.show) {
                onExpand();
              }
              orchestrator.openScreen(href, options);
            },
          }}
        >
          {/* A file the conversation offers is asked for to be seen, so it
              is shown the same way: in Chat, in the thread's pane. */}
          <FileOpenContext
            value={(path, options) => {
              onExpand();
              openFile?.(path, options);
            }}
          >
            <ActiveTabProvider isActive>
              <ThreadScreen
                isUp
                sendContext={sendContext}
                sessionId={sessionId}
              />
            </ActiveTabProvider>
          </FileOpenContext>
        </OrchestratorContext>
      </div>
    </motion.div>
  );
}

/** A tab's mark in the picture, in the box the pulse takes when it stands in for the mark. */
function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-4 shrink-0 place-items-center [&_img]:size-3.5 [&_svg]:size-3.5">
      {children}
    </span>
  );
}

/** A page tab of the window's own: the pulse while an agent it was handed to is driving it. */
function OwnTabMark({
  icon,
  targetId,
}: {
  icon: ReactNode;
  targetId: Parameters<typeof useTargetAgentActivity>[0];
}) {
  const isDriven = useTargetAgentActivity(targetId);
  return isDriven ? (
    <PlanningDotIcon className={cn("size-4")} />
  ) : (
    <Mark>{icon}</Mark>
  );
}

/**
 * The thread's tabs as they stand in its pane, drawn small under the small
 * view's head: each its mark (or the pulse while an agent is in it) and its
 * name, none in front, no plus and no cross. A press is a way to the tab,
 * in Chat, not a place to open anything.
 */
function TabPicture({
  childTitles,
  onPress,
  tabs,
}: {
  childTitles: Map<TaskId, string>;
  onPress: (tabId: string) => void;
  tabs: WindowTab[];
}) {
  const appsBySlug = useAppsBySlug();
  const { taskId } = useOrchestrator();
  return (
    <div
      aria-label="The thread's tabs"
      className="flex h-9 shrink-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto border-b border-border px-2 select-none"
      role="list"
    >
      {tabs.map((tab) => {
        const { icon, title } =
          tab.kind === "page"
            ? {
                icon: <TabIcon favicon={tab.favicon} url={tab.url} />,
                title:
                  tab.title ||
                  (tab.taskId && childTitles.get(tab.taskId)) ||
                  pageTabTitle(tab) ||
                  "New tab",
              }
            : screenPresentation(tab.href, { appsBySlug });
        const press = (
          <button
            className="inline-flex h-7 max-w-40 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => {
              onPress(tab.id);
            }}
            title={title}
            type="button"
          >
            {tab.kind === "page" ? (
              tab.taskId ? (
                <TaskTabMark icon={icon} taskId={tab.taskId} />
              ) : (
                <OwnTabMark
                  icon={icon}
                  targetId={encodeBrowserTargetId(
                    taskId,
                    StoreId.SessionSchema.parse(tab.id),
                  )}
                />
              )
            ) : (
              <Mark>{icon}</Mark>
            )}
            <span className="truncate">{title}</span>
          </button>
        );
        return (
          <div className="shrink-0" key={tab.id} role="listitem">
            {press}
          </div>
        );
      })}
    </div>
  );
}

/** A task's browser tab: the pulse while the task is in it. */
function TaskTabMark({ icon, taskId }: { icon: ReactNode; taskId: TaskId }) {
  const isWorking = useBrowserAgentActivity(taskId);
  return isWorking ? (
    <PlanningDotIcon className={cn("size-4")} />
  ) : (
    <Mark>{icon}</Mark>
  );
}
