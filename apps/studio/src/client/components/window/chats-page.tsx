import { applyDraftOpsAtom } from "@/client/drafts/store";
import { useRouter } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

import { useShowChatGroup } from "./chat-group";
import { ChatPane } from "./chat-pane";
import { useGroupTab } from "./group-tab";
import { useShell } from "./shell-context";
import { chatHref, newChatHref, projectHref } from "./window-href";

/**
 * The Chats page: the inbox, its projects, search, drafts and places, in one
 * column down the middle of its tab. A chat picked from it comes up in the
 * tab group it is in, open or closed (`useShowChatGroup`), and one in
 * neither opens in this tab, as a draft does, so Back comes back to the
 * list.
 */
export function ChatsPage() {
  const shell = useShell();
  const router = useRouter();
  const groupTab = useGroupTab();
  const showChatGroup = useShowChatGroup();
  const keepDraft = useSetAtom(applyDraftOpsAtom);
  return (
    <div className="absolute inset-0 flex justify-center overflow-hidden [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]">
      <div className="flex min-h-0 w-full max-w-170 flex-col">
        <ChatPane
          arrivedId={shell.arrivedId}
          drafts={shell.drafts}
          onDeleted={() => undefined}
          onDeleteDraft={shell.discardDraft}
          onOpenChat={(chat) => {
            if (!showChatGroup(chat.id, { from: groupTab?.group })) {
              router.history.push(chatHref(chat.id));
            }
          }}
          // The tab already writing the draft comes up, wherever it is; with
          // none, this tab goes to it.
          onOpenDraft={(id) => {
            void keepDraft([{ id, type: "keep" }]);
            shell.showDraft(id, () => {
              router.history.push(newChatHref(id));
            });
          }}
          onOpenProject={(id) => {
            router.history.push(projectHref(id));
          }}
          openChatId={undefined}
        />
      </div>
    </div>
  );
}
