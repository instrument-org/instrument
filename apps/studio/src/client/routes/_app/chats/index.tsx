import { GroupNewChatScreen } from "@/client/components/window/chat-tab-screens";
import { useGroupTab } from "@/client/components/window/group-tab";
import { matchScreen } from "@/client/components/window/window-href";
import { createFileRoute, useRouterState } from "@tanstack/react-router";

/**
 * A new chat's tab, the zero state, writing into the draft its address
 * names. As the window's own tab it is drawn by the layout around it, which
 * draws every group; the route itself has nothing to draw there.
 */
export const Route = createFileRoute("/_app/chats/")({
  component: NewChatRoute,
});

function NewChatRoute() {
  const groupTab = useGroupTab();
  const draft = useRouterState({
    select: (state) => {
      const screen = matchScreen(state.location.href);
      return screen.kind === "inbox" ? screen.draft : undefined;
    },
  });
  return groupTab ? <GroupNewChatScreen draftId={draft} /> : null;
}
