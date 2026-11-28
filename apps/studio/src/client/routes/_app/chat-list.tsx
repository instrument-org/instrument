import { NEW_TAB_HREF } from "@/client/atoms/window";
import { chatsAskOf } from "@/client/components/window/chats-ask";
import { useGroupTab } from "@/client/components/window/group-tab";
import { useSidePanel } from "@/client/components/window/side-panel-state";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useEffectEvent } from "react";

/**
 * The chat list's address, which no page draws: its chats are in the side
 * panel. A tab that comes to stand here, one restored from an earlier build
 * or a step back in its history, opens its group's side panel on the chats
 * the address names (a project's, a place's, or a search) and becomes a new
 * tab.
 */
export const Route = createFileRoute("/_app/chat-list")({
  component: ChatListRoute,
});

function ChatListRoute() {
  const groupTab = useGroupTab();
  const router = useRouter();
  const { openChats } = useSidePanel(groupTab?.group);
  const leave = useEffectEvent(() => {
    openChats(chatsAskOf(router.history.location.href) ?? {});
    router.history.replace(NEW_TAB_HREF);
  });
  useEffect(() => {
    leave();
  }, []);
  return null;
}
