import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { useState } from "react";

import { folderHref } from "@/shared/computer-href";

import { useAppsBySlug } from "./apps-by-slug";
import { ChatFolderButton, useChatFolderWithFiles } from "./chat-folder-button";
import { ChatHeader } from "./chat-header";
import { useListedChat } from "./chat-tab-menu";
import { useWindow } from "./context";
import { ChatScreen } from "./chat-screen";
import { ChatListToggle, WithChatList } from "./chats-page";
import { chatContextItems } from "./context-items";
import { ContextChips } from "./context-chip";
import { layoutReadOf } from "./group-awareness";
import { useGroupTab } from "./group-tab";
import { NewChatView } from "./new-chat-view";
import { useShell } from "./shell-context";
import { tabSurfaceAtom } from "./tab-surface";
import { useWindowTabs } from "./window-tabs";

/**
 * A chat in a tab of a group, as its route draws it: the conversation, its
 * composer carrying the tab up on the other side of the group as a chip,
 * which the person can leave out of the next message. It marks itself read
 * and takes the caret only on the side with the keyboard.
 */
export function GroupChatScreen({ chatId }: { chatId: ChatId }) {
  const groupTab = useGroupTab();
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const isActive = useIsActiveTab();
  const surfaces = useAtomValue(tabSurfaceAtom);
  // The chip left out of the next message, by its key: a tab up beside it
  // later is a chip again.
  const [leftOut, setLeftOut] = useState<string>();
  const tabId = groupTab?.id;
  const group = groupTab?.group;
  const hasKeyboard = groupTab?.hasKeyboard ?? true;
  const beside = tabId === undefined ? undefined : windowTabs.besideOf(tabId);
  const chips = (
    beside && group !== undefined
      ? chatContextItems({
          chatId,
          finderOf: (id) => surfaces[id]?.finder ?? null,
          group,
          taken: [],
          up: beside,
        })
      : []
  ).filter((item) => item.key !== leftOut);
  const awareTabs = useAwareTabs(tabId);
  // Only a line with something to say goes in, so the composer keeps no
  // empty row for it.
  const aware =
    awareTabs.length > 0 ? <AwarenessLine tabs={awareTabs} /> : undefined;
  return (
    <WithChatList openChatId={chatId}>
      <div className="absolute inset-0 flex flex-col">
        <ChatTabHead chatId={chatId} />
        <div className="relative min-h-0 flex-1">
          <ChatScreen
            chatId={chatId}
            composerLead={
              aware || chips.length > 0 ? (
                <>
                  {aware}
                  {chips.length > 0 && (
                    <ContextChips
                      items={chips}
                      onLeaveOut={(item) => {
                        setLeftOut(item.key);
                      }}
                      onShow={() => {
                        if (beside) {
                          windowTabs.select(beside.id);
                        }
                      }}
                    />
                  )}
                </>
              ) : undefined
            }
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
                isViewOpen: chips.length > 0,
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
 * What the chat's agent sees of the group this tab is in, once a message
 * goes from here: how many other tabs it has, and how many of them are
 * files, as a quiet line at the head of the composer. Nothing while the
 * chat is alone in its group.
 */
function AwarenessLine({ tabs }: { tabs: readonly { kind: string }[] }) {
  const files = tabs.filter((tab) => tab.kind === "file").length;
  return (
    <span className="flex h-7 shrink-0 items-center px-1 text-xs text-muted-foreground">
      {countOf(tabs.length, "tab")}
      {files > 0 && `, ${countOf(files, "file")}`}
    </span>
  );
}

/** The other tabs of the group a chat's tab is in, as its agent reads them. */
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

function countOf(count: number, noun: string): string {
  return `${count.toString()} ${noun}${count === 1 ? "" : "s"}`;
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
  return (
    <WithChatList openChatId={undefined} opensList={opensList}>
      <div className="absolute inset-0 flex flex-col">
        <NewChatView
          draftId={draftId}
          ensureGroup={() => group ?? ""}
          isCentered
          isPaneShown={false}
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
