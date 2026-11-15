import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { type ChatId, type LayoutTab } from "@instrument-org/workspace/client";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/client/components/ui/hover-card";

import { folderHref } from "@/shared/computer-href";
import { APP_NAME } from "@instrument-org/shared";

import { useAppsBySlug } from "./apps-by-slug";
import { ChatFolderButton, useChatFolderWithFiles } from "./chat-folder-button";
import { ChatHeader } from "./chat-header";
import { useListedChat } from "./chat-tab-menu";
import { useWindow } from "./context";
import { ChatScreen } from "./chat-screen";
import { ChatListToggle, WithChatList } from "./chats-page";
import { HeldMark } from "./context-chip";
import { layoutReadOf } from "./group-awareness";
import { useGroupTab } from "./group-tab";
import { NewChatView } from "./new-chat-view";
import { useShell } from "./shell-context";
import { useWindowTabs } from "./window-tabs";

/**
 * A chat in a tab of a group, as its route draws it: the conversation, with
 * the group's other tabs counted beside its composer's plus.
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
                isViewOpen: true,
                ...(tabId === undefined ? {} : { tabId }),
                taken: [],
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
 * The head over a chat in its tab: the toggle for the chat list, its title,
 * which renames it, and the
 * caret that opens its menu at the left; at the right, the chat's folder
 * while it has files, opened beside the chat as a click in the chat opens
 * a folder.
 */
function ChatTabHead({ chatId }: { chatId: ChatId }) {
  const groupTab = useGroupTab();
  const shell = useShell();
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  const chat = useListedChat(chatId);
  const folder = useChatFolderWithFiles(chatId);
  const tabId = groupTab?.id;
  const beside = tabId === undefined ? undefined : windowTabs.besideOf(tabId);
  const folderAt = folder === null ? undefined : folderHref(folder);
  const isFolderShown =
    folderAt !== undefined &&
    beside?.kind === "screen" &&
    beside.href === folderAt;
  return (
    <ChatHeader
      chat={chat}
      leading={<ChatListToggle />}
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
        folderAt !== undefined && (
          <ChatFolderButton
            isOpen={isFolderShown}
            onToggle={() => {
              if (isFolderShown && beside) {
                windowTabs.select(beside.id);
                return;
              }
              appWindow.openScreen(folderAt, {
                chat: chatId,
                ...(tabId === undefined ? {} : { from: tabId }),
                show: true,
              });
            }}
          />
        )
      }
    />
  );
}

/**
 * What the agent reads of the group a chat's or a new chat's tab is in:
 * how many other tabs it has (`summaryOf`), quiet beside the composer's
 * plus, whose hover says each message shares them and lists each by its
 * mark and title.
 */
function AwarenessLine({ tabs }: { tabs: readonly LayoutTab[] }) {
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  return (
    <HoverCard closeDelay={100} openDelay={200}>
      <HoverCardTrigger asChild>
        <span
          className="flex h-7 shrink-0 cursor-default items-center px-1 text-xs text-muted-foreground"
          data-slot="group-awareness"
          tabIndex={0}
        >
          {summaryOf(tabs)}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="flex w-72 flex-col gap-1 p-2"
        data-slot="group-awareness-list"
        side="top"
      >
        <p className="px-1.5 pb-1 text-xs text-muted-foreground">
          Each message you send here shares{" "}
          {tabs.length === 1 ? "this tab" : "these tabs"} with {APP_NAME}.
        </p>
        {tabs.map((tab) => {
          const open = windowTabs.allTabs.find((each) => each.id === tab.id);
          return (
            <span
              className="flex h-7 min-w-0 items-center gap-2 px-1.5 text-[13px]"
              key={tab.id}
            >
              <span className="grid size-4 shrink-0 place-items-center [&_img]:size-4 [&_svg]:size-4">
                {open && <HeldMark appsBySlug={appsBySlug} tab={open} />}
              </span>
              <span className="truncate">{tab.title || tab.address}</span>
            </span>
          );
        })}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * The count beside a composer's plus, or nothing while the tab is alone in
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

/** The count's words: every other tab of the group counted as a tab, whatever it shows. */
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
        {/* Where a chat's head has it, ahead of the title. */}
        <ChatListToggle className="absolute top-2.5 left-3" />
      </div>
    </WithChatList>
  );
}
