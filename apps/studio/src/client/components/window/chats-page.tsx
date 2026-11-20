import { useRouter } from "@tanstack/react-router";

import { ChatPane } from "./chat-pane";
import { useShell } from "./shell-context";
import { chatHref, newChatHref } from "./window-href";

/**
 * The Chats page: the inbox, its projects, search, drafts and places, in one
 * column down the middle of its tab. A chat or draft picked from it opens in
 * this tab, so Back comes back to the list.
 */
export function ChatsPage() {
  const shell = useShell();
  const router = useRouter();
  return (
    // The search the chord for searching chats puts the caret in.
    <div
      className="absolute inset-0 flex justify-center overflow-hidden [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]"
      data-chats-search=""
    >
      <div className="flex min-h-0 w-full max-w-170 flex-col">
        <ChatPane
          arrivedId={shell.arrivedId}
          drafts={shell.drafts}
          onDeleted={() => undefined}
          onDeleteDraft={shell.discardDraft}
          onOpenChat={(chat) => {
            router.history.push(chatHref(chat.id));
          }}
          // The tab already writing the draft comes up, wherever it is; with
          // none, this tab goes to it.
          onOpenDraft={(id) => {
            shell.showDraft(id, () => {
              router.history.push(newChatHref(id));
            });
          }}
          openChatId={undefined}
        />
      </div>
    </div>
  );
}
