import { tabChatFiltersAtom } from "@/client/atoms/window";
import { NO_FILTERS } from "@/client/components/window/chats";
import { ChatsPage } from "@/client/components/window/chats-page";
import { useGroupTab } from "@/client/components/window/group-tab";
import { createFileRoute } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { z } from "zod";

/**
 * The Chats page: every chat there is, as the Chat screen's inbox listed
 * them, the index Chat's chip goes to. A chat picked from the list opens in
 * this tab. An address naming a project stands
 * the list in it, as a project's All chats opens it, one naming a place
 * stands it there, as Drafts opens it, and one naming words searches for
 * them, as the address field's search row opens it.
 */
export const Route = createFileRoute("/_app/chat-list")({
  component: ChatListRoute,
  head: () => ({
    meta: [{ title: "Chats" }],
  }),
  validateSearch: z.object({
    /** The project the list stands in. */
    project: z.string().optional().catch(undefined),
    /** The place the list stands in, when not the inbox. */
    place: z.enum(["archived", "drafts"]).optional().catch(undefined),
    /** Words every chat shown has in it. */
    q: z.coerce.string().optional().catch(undefined),
  }),
});

function ChatListRoute() {
  const groupTab = useGroupTab();
  const { place, project, q } = Route.useSearch();
  const setFilters = useSetAtom(tabChatFiltersAtom(groupTab?.id ?? ""));
  useEffect(() => {
    if (place === undefined && project === undefined && q === undefined) {
      return;
    }
    setFilters({
      ...NO_FILTERS,
      ...(place === undefined ? {} : { place }),
      ...(project === undefined ? {} : { projects: [project] }),
      ...(q === undefined ? {} : { search: q }),
    });
  }, [place, project, q, setFilters]);
  // The page lays itself over the whole of its box, as a chat's does.
  return groupTab ? (
    <div className="relative h-full">
      <ChatsPage />
    </div>
  ) : null;
}
