import { tabChatFiltersAtom } from "@/client/atoms/window";
import { inPlace, NO_FILTERS } from "@/client/components/window/chats";
import { ChatsPage } from "@/client/components/window/chats-page";
import { useGroupTab } from "@/client/components/window/group-tab";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { z } from "zod";

/**
 * The Chats page: every chat there is, as the Chat screen's inbox listed
 * them, the index Chat's chip goes to. A chat picked from the list opens in
 * this tab. An address naming a project is that project's page, one naming a place
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
  const projects = useQuery(rpcClient.workspace.projects.list.queryOptions());
  // A project deleted since its address was written is every chat again.
  const isGone =
    projects.data !== undefined &&
    !projects.data.some((each) => each.id === project && !each.retired);
  const standing = isGone ? undefined : project;
  useEffect(() => {
    if (place === undefined && standing === undefined && q === undefined) {
      setFilters((current) =>
        current.projects.length === 0 ? current : inPlace(current, undefined),
      );
      return;
    }
    setFilters({
      ...NO_FILTERS,
      ...(place === undefined ? {} : { place }),
      ...(standing === undefined ? {} : { projects: [standing] }),
      ...(q === undefined ? {} : { search: q }),
    });
  }, [place, standing, q, setFilters]);
  // The page lays itself over the whole of its box, as a chat's does.
  return groupTab ? (
    <div className="relative h-full">
      <ChatsPage />
    </div>
  ) : null;
}
