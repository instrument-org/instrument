import { GroupChatScreen } from "@/client/components/window/chat-tab-screens";
import { useGroupTab } from "@/client/components/window/group-tab";
import { chatOfHref } from "@/client/components/window/window-href";
import { createFileRoute, useRouterState } from "@tanstack/react-router";

/**
 * A chat's tab. In a tab of a group it is the chat; as the window's own tab,
 * an address asking for the group with the chat's tab in it, which the
 * window moves to, so there it has nothing to draw.
 */
export const Route = createFileRoute("/_app/chats/$id")({
  component: ChatRoute,
});

function ChatRoute() {
  const groupTab = useGroupTab();
  const chat = useRouterState({
    select: (state) => chatOfHref(state.location.href),
  });
  return groupTab && chat !== undefined ? (
    <GroupChatScreen chatId={chat} />
  ) : null;
}
