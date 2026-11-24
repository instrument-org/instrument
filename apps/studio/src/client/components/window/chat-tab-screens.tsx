import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { type ChatId } from "@instrument-org/workspace/client";

import { folderHref } from "@/shared/computer-href";

import { ChatFolderButton, useChatWrittenFolders } from "./chat-folder-button";
import { ChatHeader } from "./chat-header";
import { useListedChat } from "./chat-tab-menu";
import { useWindow } from "./context";
import { ChatScreen } from "./chat-screen";
import { useGroupTab } from "./group-tab";
import { NewChatView } from "./new-chat-view";
import { useShell } from "./shell-context";
import { useWindowTabs } from "./window-tabs";

/**
 * A chat in a tab of a group, as its route draws it: the conversation, with
 * its head over it.
 * Every tab in the group goes with each message, so none of them is a chip
 * to leave out. It marks itself read whenever it is on screen, on either
 * side of a split, and takes the caret only on the side with the keyboard.
 */
export function GroupChatScreen({ chatId }: { chatId: ChatId }) {
  const groupTab = useGroupTab();
  const shell = useShell();
  const isActive = useIsActiveTab();
  const tabId = groupTab?.id;
  const hasKeyboard = groupTab?.hasKeyboard ?? true;
  const isShown = groupTab?.isShown ?? true;
  return (
    <div className="absolute inset-0 flex flex-col">
      <ChatTabHead chatId={chatId} />
      <div className="relative min-h-0 flex-1">
        <ChatScreen
          chatId={chatId}
          isUp={isActive && isShown}
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
          onSentStored={() => {
            shell.sentStored(chatId);
          }}
          sentPrompt={shell.sentWords(chatId)}
          takesCaret={isActive && hasKeyboard}
        />
      </div>
    </div>
  );
}

/**
 * The head over a chat in its tab: its title, which renames it, and the
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
  const beside = tabId === undefined ? undefined : windowTabs.besideOf(tabId);
  const shownFolder = writtenFolders.find(
    (folder) => beside?.kind === "screen" && beside.href === folderHref(folder),
  );
  return (
    <ChatHeader
      chat={chat}
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
 * A new chat in a tab of a group, as its route draws it: the zero state,
 * writing into the draft its address names once it has words.
 */
export function GroupNewChatScreen({ draftId }: { draftId?: string }) {
  const groupTab = useGroupTab();
  const isActive = useIsActiveTab();
  const tabId = groupTab?.id ?? "";
  const group = groupTab?.group;
  const hasKeyboard = groupTab?.hasKeyboard ?? true;
  return (
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
    </div>
  );
}
