import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { ChatScreen } from "./chat-screen";
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
  const aware =
    tabId === undefined ? undefined : <AwarenessLine chatTab={tabId} />;
  return (
    <div className="absolute inset-0">
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
  );
}

/**
 * What the chat's agent sees of the group this tab is in, once a message
 * goes from here: how many other tabs it has, and how many of them are
 * files, as a quiet line at the head of the composer. Nothing while the
 * chat is alone in its group.
 */
function AwarenessLine({ chatTab }: { chatTab: string }) {
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const { chatTitles } = useShell();
  const tabs =
    layoutReadOf({ appsBySlug, chatTitles, windowTabs }, chatTab)
      ?.layout.sides.flatMap((side) => side.tabs)
      .filter((tab) => tab.isThisChat !== true && tab.kind !== "newChat") ??
    [];
  if (tabs.length === 0) {
    return null;
  }
  const files = tabs.filter((tab) => tab.kind === "file").length;
  return (
    <span className="flex h-7 shrink-0 items-center px-1 text-xs text-muted-foreground">
      {countOf(tabs.length, "tab")}
      {files > 0 && `, ${countOf(files, "file")}`}
    </span>
  );
}

function countOf(count: number, noun: string): string {
  return `${count.toString()} ${noun}${count === 1 ? "" : "s"}`;
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
    <NewChatView
      draftId={draftId}
      ensureGroup={() => group ?? ""}
      isCentered
      isPaneShown={false}
      onOpenBeside={() => undefined}
      tabId={tabId}
      takesCaret={isActive && hasKeyboard}
    />
  );
}
