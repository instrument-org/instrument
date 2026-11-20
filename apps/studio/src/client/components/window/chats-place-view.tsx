import { CaptionRoom } from "@/client/components/window-controls";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { CHATS_PLACE_GROUP } from "@/shared/kept-state";
import { useQuery } from "@tanstack/react-query";
import { noop } from "radashi";
import { useEffect, useEffectEvent } from "react";

import { chatListOptions } from "./chat-list-query";
import { ChatsPlaceContext, useChatsPlace } from "./chats-place";
import { GroupItem } from "./group-item";
import { GROUP_GROUNDS } from "./group-view";
import { PaneTopContext } from "./pane-top";
import { WINDOW_CARD } from "./window-frame";
import { CHATS_INDEX_HREF, chatOfHref, sameHref } from "./window-href";
import { useWindowTabs } from "./window-tabs";

/**
 * The Chats place, everything right of the sidebar while it is up: one card
 * with the chat list down its left and the chat picked in it beside, live,
 * drawn by the place's one tab as a group's tab is drawn, with no strip and
 * nothing to close it by. Its corner keeps only the window's own end.
 */
export function ChatsPlaceView() {
  const isActive = useIsActiveTab();
  const windowTabs = useWindowTabs();
  const place = useChatsPlace();
  const up = windowTabs.selectedTabIn(CHATS_PLACE_GROUP);
  const chats = useQuery(chatListOptions()).data;
  // A place reached by its address alone (a relaunch, a step back) with no
  // tab yet gets one, and one left at the Chats page while no chat was
  // there takes the first once one is.
  const settle = useEffectEvent(() => {
    const isWaitingOnChats =
      up?.kind === "screen" &&
      sameHref(up.href, CHATS_INDEX_HREF) &&
      chats !== undefined &&
      chats.some((chat) => !chat.archived);
    if (up === undefined || isWaitingOnChats) {
      place.enter();
    }
  });
  useEffect(() => {
    settle();
  }, [up?.id, chats]);
  return (
    <div
      className={GROUP_GROUNDS}
      // The place draws its own card, so the window's card stands back.
      {...(isActive ? { "data-own-cards": "" } : {})}
    >
      <div
        className={cn(
          "flex h-full min-h-0 min-w-0 flex-1 flex-col",
          WINDOW_CARD,
        )}
        data-group-side={0}
        data-keyboard=""
      >
        <div className="relative min-h-0 flex-1" data-side-page={0}>
          {up && (
            <ChatsPlaceContext value={{ away: place.away }}>
              <PaneTopContext value={{ corner: <CaptionRoom />, lead: null }}>
                <GroupItem
                  closeTab={() => {
                    place.away(
                      up.kind === "screen" ? chatOfHref(up.href) : undefined,
                    );
                  }}
                  group={CHATS_PLACE_GROUP}
                  isShown
                  key={up.id}
                  onPageChrome={noop}
                  onPageHost={noop}
                  up={up}
                />
              </PaneTopContext>
            </ChatsPlaceContext>
          )}
        </div>
      </div>
    </div>
  );
}
