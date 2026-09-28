import {
  inboxOpenAtom,
  orchestratorSidebarWidthAtom,
  paneOpenByGroupAtom,
  type ScreenView,
  screenViewAtom,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  THREADS_HREF,
  WEB_HREF,
} from "@/client/atoms/orchestrator";
import { FileOpenContext } from "@/client/components/file-open-context";
import {
  CHAT_HREF,
  groupOfHref,
  isChatHref,
  PAGE_HREF,
} from "@/client/components/orchestrator/app-tabs";
import { useAppsBySlug } from "@/client/components/orchestrator/apps-by-slug";
import { type PageChromeSlots } from "@/client/components/orchestrator/browser-tabs";
import { GroupItem } from "@/client/components/orchestrator/compose-window";
import {
  OrchestratorContext,
  useOrchestrator,
} from "@/client/components/orchestrator/context";
import { computerTabOf } from "@/client/components/orchestrator/file-tabs";
import { InboxToggle } from "@/client/components/orchestrator/inbox-toggle";
import { RightPane } from "@/client/components/orchestrator/right-pane";
import { screenLocation } from "@/client/components/orchestrator/screen-presentation";
import { useShell } from "@/client/components/orchestrator/shell-context";
import { tasksHref } from "@/client/components/orchestrator/tab-location";
import { TabLocationRow } from "@/client/components/orchestrator/tab-location-row";
import { ThreadHeader } from "@/client/components/orchestrator/thread-header";
import { ThreadPane } from "@/client/components/orchestrator/thread-pane";
import { ThreadRail } from "@/client/components/orchestrator/thread-rail";
import { ThreadStage } from "@/client/components/orchestrator/thread-stage";
import {
  parseHref,
  threadOfHref,
  useWindowTabs,
} from "@/client/components/orchestrator/window-tabs";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { instrumentFolderHref } from "@/shared/computer-href";
import { APP_NAME } from "@instrument-org/shared";
import {
  encodeBrowserTargetId,
  StoreId,
} from "@instrument-org/workspace/client";
import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** Dragged narrower than this, the inbox column slides shut rather than stopping at its floor. */
const INBOX_COLLAPSE_THRESHOLD = 240;
/** How far past its widest the inbox is dragged before it takes the row and the thread beside it goes. */
const INBOX_COVER_PAST = 80;
/** The least the conversation and its pane keep beside the inbox. */
const MAIN_WIDTH_MIN = 560;
/** Narrower than this beside the inbox, the conversation and its pane are crowded and the inbox steps aside. */
const MAIN_WIDTH_CROWDED = 720;

export const Route = createFileRoute("/orchestrator")({
  component: OrchestratorTab,
  head: () => ({ meta: [{ title: APP_NAME }] }),
});

/**
 * The column the inbox stands in: beside the right area, the resizable rail
 * the way the classic window keeps its sidebar, sliding shut when dragged
 * under its floor or put away by the bar's toggle, and giving the whole row
 * to the inbox when dragged past its widest; with nothing on the right, the
 * whole width outright. The pane inside is re-laid between the two, so
 * anything it has to keep lives outside it.
 */
function ChatColumn({
  bounds,
  children,
  isOpen,
  isRightAreaOpen,
  onCollapse,
  onCover,
}: {
  bounds: RailBounds;
  children: ReactNode;
  isOpen: boolean;
  isRightAreaOpen: boolean;
  onCollapse: () => void;
  onCover: () => void;
}) {
  if (!isRightAreaOpen) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    );
  }
  return (
    <StudioSidebarRail
      bounds={bounds}
      isOpen={isOpen}
      label="Resize the inbox"
      onCollapse={onCollapse}
      onCover={onCover}
      panelClassName="bg-background"
      widthAtom={orchestratorSidebarWidthAtom}
    >
      {children}
    </StudioSidebarRail>
  );
}

/**
 * The chat: the inbox down the left, and beside it the chat this tab has
 * open, its transcript and composer, the thing it has up drawn large, and
 * what it holds down its right edge. Choosing another chat in the inbox
 * moves this tab there, one step on in its history.
 */
function ChatView({ thread }: { thread: StoreId.Session | undefined }) {
  const shell = useShell();
  const orchestrator = useOrchestrator();
  const { appTabs, rowWidth, setPaneOpen, threads, threadTitles } = shell;
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const [isInboxOpen, setInboxOpen] = useAtom(inboxOpenAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(orchestratorSidebarWidthAtom);
  const paneOpenByGroup = useAtomValue(paneOpenByGroupAtom);
  const isActive = useIsActiveTab();
  const showsRightArea = thread !== undefined;
  const bounds = inboxBounds(rowWidth);
  // An inbox left at the row's whole width, or a window grown narrower,
  // gives the conversation its least back as soon as something is beside it.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    if (showsRightArea && rowWidth > 0 && sidebarWidth > bounds.max) {
      setSidebarWidth(bounds.max);
    }
  }, [
    isActive,
    showsRightArea,
    rowWidth,
    sidebarWidth,
    bounds.max,
    setSidebarWidth,
  ]);
  // A row too narrow for the inbox and a chat beside it gives the chat the
  // row: the inbox steps aside as the row crosses into crowded, and comes
  // back as it crosses out, unless someone put it away or brought it back
  // in between. Only the crossing acts, so either choice holds at any width.
  const isCrowded =
    isActive &&
    showsRightArea &&
    rowWidth > 0 &&
    rowWidth - sidebarWidth < MAIN_WIDTH_CROWDED;
  const steppedAsideRef = useRef(false);
  useEffect(() => {
    if (isCrowded) {
      if (isInboxOpen) {
        steppedAsideRef.current = true;
        setInboxOpen(false);
      }
      return;
    }
    if (steppedAsideRef.current && !isInboxOpen) {
      setInboxOpen(true);
    }
    steppedAsideRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCrowded]);
  // Brought back by hand, the inbox is someone's choice from then on.
  useEffect(() => {
    if (isInboxOpen) {
      steppedAsideRef.current = false;
    }
  }, [isInboxOpen]);

  /** Puts the chat away: the inbox takes the width, shown again if it was hidden. */
  const leaveChat = () => {
    appTabs.navigate(CHAT_HREF);
    setInboxOpen(true);
  };

  // The chat's tabs, and the one it has up.
  const tabs =
    thread === undefined
      ? []
      : windowTabs.allTabs.filter((tab) => tab.group === thread);
  const up = windowTabs.tabUpIn(thread);
  const isPaneWanted =
    thread === undefined || (paneOpenByGroup[thread] ?? true);
  const showsPane = up !== undefined && isPaneWanted;
  const isFloating = shell.compose.entries.some(
    (entry) => entry.kind === "thread" && entry.sessionId === thread,
  );
  // Drawn only once there is something in it.
  const showsRail = thread !== undefined && tabs.length > 0;

  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  usePageSlot(
    showsPane && up.kind === "page" ? pageHost : null,
    pageChrome,
    showsPane && up.kind === "page",
  );
  const reportView = useScreenViewOfTab();

  const threadRecord = threads?.find((entry) => entry.id === thread);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ChatColumn
        bounds={bounds}
        isOpen={isInboxOpen}
        isRightAreaOpen={showsRightArea}
        onCollapse={() => {
          setInboxOpen(false);
        }}
        onCover={leaveChat}
      >
        {/* `select-text`: the window's shell is chrome and turns selection off; the chat is text. */}
        <div className="flex min-h-0 w-full flex-1 flex-col select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]">
          {/* A plain click on a row opens in this tab, and a middle or
            modified click asks for a tab of its own. */}
          <OrchestratorContext value={{ ...orchestrator, opensNewTab: false }}>
            <ThreadPane
              arrivedId={shell.arrivedId}
              drafts={shell.drafts}
              onDeleteDraft={shell.deleteDraft}
              onListed={isActive ? shell.onListed : undefined}
              onOpenDraft={shell.showDraft}
              onOpenThread={(entry) => {
                orchestrator.openScreen(`${THREADS_HREF}/${entry.id}`);
              }}
              openThreadId={thread}
            />
          </OrchestratorContext>
        </div>
      </ChatColumn>
      {thread !== undefined && (
        <main className="relative flex min-w-0 flex-1 flex-col">
          {/* A container: the first thing to give way as the row narrows
            is the rail, which folds to its marks. */}
          <div className="@container/threadrow flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1">
              <RightPane
                conversation={
                  <div className="relative flex h-full min-h-0 flex-col">
                    <div className="absolute inset-0 flex flex-col">
                      <ThreadHeader
                        // Ahead of the title, the inbox column put away or
                        // brought back, so the chat and its tabs can have
                        // the window.
                        leading={<InboxToggle isCollapsible={showsRightArea} />}
                        onDeleted={() => {
                          // The chat and the tabs it had are gone; the inbox
                          // takes the tab back.
                          windowTabs.forgetGroup(thread);
                          appTabs.navigate(CHAT_HREF, { replace: true });
                          setInboxOpen(true);
                        }}
                        onNewTopic={shell.onNewTopic}
                        onSetTopics={(next) => {
                          shell.setThreadTopics(thread, next);
                        }}
                        onViewTasks={() => {
                          orchestrator.openScreen(tasksHref(thread), {
                            newTab: true,
                          });
                        }}
                        popOut={{
                          isOut: isFloating,
                          // Popped out, the chat stays listed and is simply
                          // no longer the one this tab has open.
                          onToggle: () => {
                            if (isFloating) {
                              shell.compose.remove(thread);
                            } else {
                              shell.compose.float(thread);
                              leaveChat();
                            }
                          },
                        }}
                        thread={threadRecord}
                        topics={shell.topics}
                      />
                      <div className="relative min-h-0 flex-1">
                        <ThreadStage
                          sendContext={shell.sendContext}
                          sessionId={thread}
                        />
                      </div>
                    </div>
                  </div>
                }
                fills={false}
                isOpen={showsPane}
                onCollapse={() => {
                  setPaneOpen(thread, false);
                }}
                paneKey={thread}
              >
                <div
                  className={cn(
                    "flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border",
                    // A page's bottom corners follow what they meet: square
                    // against the conversation at the left and against the
                    // rail at the right, round only where the pane reaches
                    // the card's own corner.
                    showsRail
                      ? "[--guest-bottom-radius:0] [--pane-bottom-right-radius:0]"
                      : "[--guest-bottom-radius:0_var(--radius-2xl)]",
                  )}
                >
                  {up && (
                    <GroupItem
                      closeTab={shell.requestClose}
                      group={thread}
                      isFramed={false}
                      // Puts the view away; what it showed stays on the
                      // rail, whose tiles are where a tab is closed.
                      onClose={() => {
                        setPaneOpen(thread, false);
                      }}
                      onPageChrome={setPageChrome}
                      onPageHost={setPageHost}
                      onScreenView={reportView}
                      outside={{
                        label: "Open in a tab",
                        note: "Opens in a tab of its own.",
                        onOpen: (tab) => {
                          appTabs.open(tab.href);
                        },
                      }}
                      up={up}
                    />
                  )}
                </div>
              </RightPane>
            </div>
            {showsRail && (
              <ThreadRail
                activeId={up?.id}
                appsBySlug={appsBySlug}
                isThreadWorking={threadRecord?.state === "working"}
                isViewOpen={showsPane}
                onAddComputer={() => {
                  windowTabs.openScreen(instrumentFolderHref(), {
                    activate: true,
                    group: thread,
                  });
                  setPaneOpen(thread, true);
                }}
                onAddWeb={() => {
                  windowTabs.openScreen(WEB_HREF, {
                    activate: true,
                    group: thread,
                  });
                  setPaneOpen(thread, true);
                }}
                onClose={shell.requestClose}
                onReorder={(keys) => {
                  windowTabs.reorder(keys, thread);
                }}
                onSelect={(id) => {
                  windowTabs.selectIn(thread, id);
                  setPaneOpen(thread, true);
                }}
                tabs={tabs}
                targetOf={(tab) =>
                  encodeBrowserTargetId(
                    tab.taskId ?? shell.ids.taskId,
                    StoreId.SessionSchema.parse(tab.id),
                  )
                }
                taskTitles={shell.childTitles}
                threadTitles={threadTitles}
              />
            )}
          </div>
        </main>
      )}
    </div>
  );
}

/**
 * How wide the inbox column may be beside the right area: the row less what
 * the conversation keeps, within the column's own floor and ceiling; a drag
 * past that by a margin covers the row.
 */
function inboxBounds(rowWidth: number): RailBounds {
  const max = Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.max(SIDEBAR_WIDTH_MIN, rowWidth - MAIN_WIDTH_MIN),
  );
  return {
    collapse: INBOX_COLLAPSE_THRESHOLD,
    cover: max + INBOX_COVER_PAST,
    initial: SIDEBAR_WIDTH_MIN,
    max,
    min: SIDEBAR_WIDTH_MIN,
  };
}

/**
 * One of the window's tabs, as its address has it: the chat, a site opened
 * at the window's level, or a screen that is its own route under the row
 * that says where it stands. The window around the tabs is drawn once, by
 * the window, whatever tab is up.
 */
function OrchestratorTab() {
  const href = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  if (isChatHref(href)) {
    return <ChatView thread={threadOfHref(href)} />;
  }
  const group = groupOfHref(href);
  if (parseHref(href).pathname === PAGE_HREF && group !== undefined) {
    return <SiteView group={group} />;
  }
  return <RouteScreen href={href} />;
}

/**
 * A screen that is its own route (the Finder, a file, the apps, an app,
 * Discover, a skill), under the row that says where it stands. Its steps are
 * the tab's history, walked by the arrows in the window's bar.
 */
function RouteScreen({ href }: { href: string }) {
  const orchestrator = useOrchestrator();
  const shell = useShell();
  const appsBySlug = useAppsBySlug();
  const screenView = useAtomValue(screenViewAtom);
  usePageSlot(null, undefined, false);
  // The row's head and tail, where a file's viewer puts a toggle for its
  // panel and its actions.
  const [rowLead, setRowLead] = useState<HTMLElement | null>(null);
  const [rowTail, setRowTail] = useState<HTMLElement | null>(null);
  const isFileScreen = computerTabOf(href)?.file !== undefined;
  const fromHref = screenLocation(href, {
    appsBySlug,
    taskTitles: shell.childTitles,
    threadTitles: shell.threadTitles,
  });
  const location =
    fromHref.kind === "folder" && screenView?.folder
      ? { ...fromHref, path: screenView.folder.display }
      : fromHref;
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabLocationRow
        {...(isFileScreen
          ? {
              leading: (
                <div
                  className="flex shrink-0 items-center empty:hidden"
                  ref={setRowLead}
                />
              ),
              trailing: (
                <div
                  className="flex shrink-0 items-center gap-0.5"
                  ref={setRowTail}
                />
              ),
            }
          : {})}
        location={location}
      />
      <OrchestratorContext value={{ ...orchestrator, rowLead, rowTail }}>
        <FileOpenContext
          value={(path, options) => {
            orchestrator.openPath(path, options);
          }}
        >
          <PageOpenContext
            value={(url) => {
              orchestrator.openPage(url);
            }}
          >
            <div className="relative min-h-0 flex-1">
              <Outlet />
            </div>
          </PageOpenContext>
        </FileOpenContext>
      </OrchestratorContext>
    </div>
  );
}

/**
 * A site opened at the window's own level: the page its group has up, under
 * the address row a chat's page wears, whose arrows walk the page's own
 * history.
 */
function SiteView({ group }: { group: string }) {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const up = windowTabs.tabUpIn(group);
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  usePageSlot(up?.kind === "page" ? pageHost : null, pageChrome, true);
  const reportView = useScreenViewOfTab();
  if (!up) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        This page is closed.
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GroupItem
        closeTab={shell.requestClose}
        group={group}
        isFramed={false}
        onPageChrome={setPageChrome}
        onPageHost={setPageHost}
        onScreenView={reportView}
        outside={{
          label: "Open in a tab",
          note: "Opens in a tab of its own.",
          onOpen: (tab) => {
            shell.appTabs.open(tab.href);
          },
        }}
        up={up}
      />
    </div>
  );
}

/**
 * Where this tab wants the window's page drawn, told to the window while the
 * tab is the one up: a tab behind leaves the page to the tab in front.
 */
function usePageSlot(
  host: HTMLElement | null,
  chrome: PageChromeSlots | undefined,
  isShown: boolean,
) {
  const { reportPageSlot } = useShell();
  const isActive = useIsActiveTab();
  useEffect(() => {
    if (!isActive) {
      return;
    }
    reportPageSlot(host ? { chrome, host, isShown } : null);
  }, [chrome, host, isActive, isShown, reportPageSlot]);
}

/**
 * What a screen in this tab has up, told to the window while the tab is the
 * one up, for what goes with a message.
 */
function useScreenViewOfTab() {
  const isActive = useIsActiveTab();
  const setScreenView = useSetAtom(screenViewAtom);
  const [view, setView] = useState<null | ScreenView>(null);
  useEffect(() => {
    if (isActive) {
      setScreenView(view);
    }
  }, [isActive, setScreenView, view]);
  return setView;
}
