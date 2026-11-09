import { ActivityPage } from "@/client/components/activity/activity-page";
import { SHOWS } from "@/client/components/activity/activity-timeline";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Activity: what the person did in the app and the AI requests its chats
 * made, as a tab of its own. What it shows is in its address (the filter,
 * the search and the row open beside the list), so a link can open it
 * filtered (the browser's History opens it at its pages) and the window's
 * Activity button can take it back to the start. Each change replaces the
 * address rather than adding a step to go back through.
 */
export const Route = createFileRoute("/_app/activity")({
  component: ActivityRoute,
  head: () => ({
    meta: [{ title: "Activity" }],
  }),
  validateSearch: z.object({
    /** The row whose details are open beside the list, by its id. */
    item: z.string().optional().catch(undefined),
    /** Words every row shown has in it. */
    q: z.string().optional().catch(undefined),
    /** The one kind of row shown; all of them without it. */
    show: z.enum(SHOWS).optional().catch(undefined),
  }),
});

function ActivityRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ActivityPage
      item={search.item}
      onSearch={(next) => {
        void navigate({
          replace: true,
          search: (current) => {
            const merged = { ...current, ...next };
            return {
              ...(merged.item ? { item: merged.item } : {}),
              ...(merged.q ? { q: merged.q } : {}),
              ...(merged.show ? { show: merged.show } : {}),
            };
          },
        });
      }}
      q={search.q ?? ""}
      show={search.show}
    />
  );
}
