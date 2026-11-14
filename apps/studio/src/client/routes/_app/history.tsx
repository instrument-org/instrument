import { HistoryPage } from "@/client/components/window/history-page";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * History: every chat and kept draft no window has open, newest first, as
 * the sidebar's History row and ⌘Y open it. The words it is narrowed to are
 * in its address, replaced as they are typed.
 */
export const Route = createFileRoute("/_app/history")({
  component: HistoryRoute,
  head: () => ({
    meta: [{ title: "History" }],
  }),
  validateSearch: z.object({
    /** Words every chat shown has in it. */
    q: z.coerce.string().optional().catch(undefined),
  }),
});

function HistoryRoute() {
  const { q } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HistoryPage
      onSearch={(next) => {
        void navigate({ replace: true, search: next ? { q: next } : {} });
      }}
      q={q ?? ""}
    />
  );
}
