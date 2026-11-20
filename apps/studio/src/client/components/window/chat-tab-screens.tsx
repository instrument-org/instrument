import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { type ChatId, type LayoutTab } from "@instrument-org/workspace/client";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/client/components/ui/hover-card";

import { PageFavicon } from "@/client/components/favicon";
import { folderHref } from "@/shared/computer-href";

import { useAppsBySlug } from "./apps-by-slug";
import { ChatFolderButton, useChatWrittenFolders } from "./chat-folder-button";
import { ChatHeader } from "./chat-header";
import { useListedChat } from "./chat-tab-menu";
import { useWindow } from "./context";
import { ChatScreen } from "./chat-screen";
import { ChatListToggle, WithChatList } from "./chats-page";
import { useChatsPlaceAround } from "./chats-place";
import { HeldMark } from "./context-chip";
import { layoutReadOf } from "./group-awareness";
import { useGroupTab } from "./group-tab";
import { NewChatView } from "./new-chat-view";
import { useShell } from "./shell-context";
import { useWindowTabs } from "./window-tabs";

/**
 * A chat in a tab of a group, as its route draws it: the conversation, with
 * the group's other tabs marked beside its composer's plus.
 * Every tab in the group goes with each message, so none of them is a chip
 * to leave out. It marks itself read and takes the caret only on the side
 * with the keyboard.
 */
export function GroupChatScreen({ chatId }: { chatId: ChatId }) {
  const groupTab = useGroupTab();
  const shell = useShell();
  const isActive = useIsActiveTab();
  const tabId = groupTab?.id;
  const hasKeyboard = groupTab?.hasKeyboard ?? true;
  const awareTabs = useAwareTabs(tabId);
  return (
    <WithChatList openChatId={chatId}>
      <div className="absolute inset-0 flex flex-col">
        <ChatTabHead chatId={chatId} />
        <div className="relative min-h-0 flex-1">
          <ChatScreen
            chatId={chatId}
            composerOffer={awarenessOf(awareTabs)}
            isUp={isActive && hasKeyboard}
            key={chatId}
            {...(tabId === undefined
              ? {}
              : { layoutContext: () => shell.layoutContext(tabId) })}
            onGone={() => {
              groupTab?.close();
            }}
            sendContext={() =>
              shell.sendContext({
                chatId,
                ...(tabId === undefined ? {} : { tabId }),
              })
            }
            sentPrompt={shell.sentWords.get(chatId)}
            takesCaret={isActive && hasKeyboard}
          />
        </div>
      </div>
    </WithChatList>
  );
}

/**
 * The head over a chat in its tab: the toggle for the chat list (none in
 * the Chats place, whose list stays), its title,
 * which renames it, and the
 * caret that opens its menu at the left; at the right, the folders the
 * chat saved files in, each opened beside the chat as a click in the chat
 * opens a folder.
 */
function ChatTabHead({ chatId }: { chatId: ChatId }) {
  const groupTab = useGroupTab();
  const shell = useShell();
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  const chat = useListedChat(chatId);
  const writtenFolders = useChatWrittenFolders(chatId);
  const tabId = groupTab?.id;
  const isPlace = useChatsPlaceAround() !== null;
  const beside = tabId === undefined ? undefined : windowTabs.besideOf(tabId);
  const shownFolder = writtenFolders.find(
    (folder) => beside?.kind === "screen" && beside.href === folderHref(folder),
  );
  return (
    <ChatHeader
      chat={chat}
      {...(isPlace ? { leading: <ChatListToggle /> } : {})}
      onArchived={() => {
        groupTab?.close();
      }}
      onDeleted={() => {
        groupTab?.close();
      }}
      onNewProject={(name) => {
        shell.onNewProject(chatId, name);
      }}
      onSetProject={(next) => {
        shell.setChatProject(chatId, next);
      }}
      projects={shell.projects}
      trailing={
        <ChatFolderButton
          folders={writtenFolders}
          onHide={() => {
            if (beside && shownFolder) {
              windowTabs.close(beside.id);
            }
          }}
          onOpen={(folder) => {
            appWindow.openScreen(folderHref(folder), {
              chat: chatId,
              ...(tabId === undefined ? {} : { from: tabId }),
              show: true,
            });
          }}
          shown={shownFolder}
        />
      }
    />
  );
}

/**
 * What the agent reads of the group a chat's or a new chat's tab is in,
 * quiet beside the composer's plus: each other tab's mark in grey, with no
 * words, so it never reads as something to press. Past `SHOWN_MARKS` the
 * row stops and its last two marks fade out, so it never widens the
 * composer. Its hover says what the marks are for, then lists every tab by
 * its mark, in its own colors, and its title. No mark names itself on hover,
 * so the list is the one thing a hover shows.
 */
export function AwarenessLine({ tabs }: { tabs: readonly LayoutTab[] }) {
  const isCut = tabs.length > SHOWN_MARKS;
  return (
    <HoverCard closeDelay={100} openDelay={200}>
      <HoverCardTrigger asChild>
        <span
          aria-label={summaryOf(tabs)}
          className="flex h-7 shrink-0 cursor-default items-center gap-1.5 px-1 text-muted-foreground"
          data-slot="group-awareness"
          tabIndex={0}
        >
          {tabs.slice(0, SHOWN_MARKS).map((tab, index) => (
            <span
              className="grid size-3.5 shrink-0 place-items-center grayscale [&_img]:size-3.5 [&_svg]:size-3.5"
              key={tab.id}
              style={{
                opacity: isCut
                  ? (FADING_MARKS[
                      index - (SHOWN_MARKS - FADING_MARKS.length)
                    ] ?? MUTED_MARK)
                  : MUTED_MARK,
              }}
            >
              <AwareTabMark tab={tab} />
            </span>
          ))}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="flex w-72 flex-col p-1.5"
        data-slot="group-awareness-list"
        side="top"
      >
        <span className="px-1.5 pt-1 pb-1.5 text-[13px] text-muted-foreground">
          {AWARENESS_NOTE}
        </span>
        {tabs.map((tab) => (
          <span
            className="flex h-7 min-w-0 items-center gap-2 px-1.5 text-[13px]"
            key={tab.id}
          >
            <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_svg]:size-4">
              <AwareTabMark tab={tab} />
            </span>
            <span className="truncate">{tab.title || tab.address}</span>
          </span>
        ))}
      </HoverCardContent>
    </HoverCard>
  );
}

/** The line over the hover's list, the same in a new chat and a begun one. */
const AWARENESS_NOTE = "Messages you send here include these tabs.";

/** How many of the group's other tabs the row beside the plus draws a mark for. */
const SHOWN_MARKS = 5;
/** How strongly a grey mark shows. */
const MUTED_MARK = 0.55;
/** How strongly the row's last marks show while it leaves tabs out, fading to its end. */
const FADING_MARKS = [0.3, 0.14];

/**
 * A tab of the group by the mark its strip tab wears: a page's favicon, a
 * chat's bubble, a file's type. A favicon here never names its site on
 * hover, which would cover the list.
 */
function AwareTabMark({ tab }: { tab: LayoutTab }) {
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const open = windowTabs.allTabs.find((each) => each.id === tab.id);
  if (open?.kind === "page") {
    return (
      <PageFavicon
        className="size-3.5"
        favicon={open.favicon}
        hasTooltip={false}
        url={open.url}
      />
    );
  }
  return open ? <HeldMark appsBySlug={appsBySlug} tab={open} /> : null;
}

/**
 * The marks beside a composer's plus, or nothing while the tab is alone in
 * its group.
 */
function awarenessOf(tabs: readonly LayoutTab[]) {
  return tabs.length > 0 ? <AwarenessLine tabs={tabs} /> : undefined;
}

/** The other tabs of the group a chat's or a new chat's tab is in, as its agent reads them. */
function useAwareTabs(chatTab: string | undefined) {
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const { chatTitles } = useShell();
  if (chatTab === undefined) {
    return [];
  }
  return (
    layoutReadOf({ appsBySlug, chatTitles, windowTabs }, chatTab)
      ?.layout.sides.flatMap((side) => side.tabs)
      .filter((tab) => tab.isThisChat !== true && tab.kind !== "newChat") ?? []
  );
}

/** The marks' words for a screen reader: every other tab of the group counted as a tab, whatever it shows. */
function summaryOf(tabs: readonly LayoutTab[]): string {
  return `${tabs.length.toString()} tab${tabs.length === 1 ? "" : "s"}`;
}

/**
 * A new chat in a tab of a group, as its route draws it: the zero state,
 * writing into the draft its address names once it has words. The Chats
 * page is this with the chat list open beside it (`opensList`).
 */
export function GroupNewChatScreen({
  draftId,
  opensList = false,
}: {
  draftId?: string;
  opensList?: boolean;
}) {
  const groupTab = useGroupTab();
  const isActive = useIsActiveTab();
  const tabId = groupTab?.id ?? "";
  const group = groupTab?.group;
  const hasKeyboard = groupTab?.hasKeyboard ?? true;
  const awareTabs = useAwareTabs(groupTab?.id);
  return (
    <WithChatList openChatId={undefined} opensList={opensList}>
      <div className="absolute inset-0 flex flex-col">
        <NewChatView
          draftId={draftId}
          ensureGroup={() => group ?? ""}
          isCentered
          isPaneShown={false}
          besidePlus={awarenessOf(awareTabs)}
          onOpenBeside={() => undefined}
          tabId={tabId}
          takesCaret={isActive && hasKeyboard}
        />
      </div>
    </WithChatList>
  );
}
