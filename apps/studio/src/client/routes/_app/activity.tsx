import { ActivityPage } from "@/client/components/activity/activity-page";
import { SHOWS } from "@/client/components/activity/activity-timeline";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Activity: what the person did in the app and the AI requests its chats
 * made, as a tab of its own. What it shows is in its address, so a link can
 * open it filtered (the browser's History opens it at its pages), and each
 * change replaces the address rather than adding a step to go back through.
 */
export const Route = createFileRoute("/_app/activity")({
  component: ActivityRoute,
  head: () => ({
    meta: [{ title: "Activity" }],
  }),
  validateSearch: z.object({
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
      onSearch={(next) => {
        void navigate({
          replace: true,
          search: (current) => {
            const merged = { ...current, ...next };
            return {
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
