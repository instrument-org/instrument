import { BookmarksPage } from "@/client/components/bookmarks/bookmarks-page";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Bookmarks, a browser's bookmark manager, as a tab of its own. The search
 * is in its address, so a link can open it searched; each change replaces
 * the address rather than adding a step to go back through.
 */
export const Route = createFileRoute("/_app/bookmarks")({
  component: BookmarksRoute,
  head: () => ({
    meta: [{ title: "Bookmarks" }],
  }),
  validateSearch: z.object({
    /** Words every bookmark shown has in its name or its address. */
    q: z.string().optional().catch(undefined),
  }),
});

function BookmarksRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <BookmarksPage
      onSearch={(q) => {
        void navigate({ replace: true, search: q ? { q } : {} });
      }}
      q={search.q ?? ""}
    />
  );
}
