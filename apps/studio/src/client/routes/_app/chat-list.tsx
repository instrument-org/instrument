import { chatFiltersAtom } from "@/client/atoms/window";
import { NO_FILTERS } from "@/client/components/window/chats";
import { ChatsPage } from "@/client/components/window/chats-page";
import { createFileRoute } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { z } from "zod";

/**
 * The Chats page: every chat there is, as the Chat screen's inbox listed
 * them, the index Chat's chip goes to. An address naming a project stands
 * the list in it, as a project's All chats opens it, and one naming words
 * searches for them, as the address field's search row opens it.
 */
export const Route = createFileRoute("/_app/chat-list")({
  component: ChatListRoute,
  head: () => ({
    meta: [{ title: "Chats" }],
  }),
  validateSearch: z.object({
    /** The project the list stands in. */
    project: z.string().optional().catch(undefined),
    /** Words every chat shown has in it. */
    q: z.coerce.string().optional().catch(undefined),
  }),
});

function ChatListRoute() {
  const { project, q } = Route.useSearch();
  const setFilters = useSetAtom(chatFiltersAtom);
  useEffect(() => {
    if (project === undefined && q === undefined) {
      return;
    }
    setFilters({
      ...NO_FILTERS,
      ...(project === undefined ? {} : { projects: [project] }),
      ...(q === undefined ? {} : { search: q }),
    });
  }, [project, q, setFilters]);
  return <ChatsPage />;
}
