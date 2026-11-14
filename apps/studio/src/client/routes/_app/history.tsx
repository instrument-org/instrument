import { HistoryPage } from "@/client/components/window/history-page";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * History: every chat and kept draft no window has open, newest first, as
 * the sidebar's History row and ⌘Y open it; with `show=chats`, every chat
 * there is, the index Chat's chip goes to; with `project`, only what is
 * filed under that project, as its sidebar's All chats opens it. The words
 * it is narrowed to are in its address, replaced as they are typed.
 */
export const Route = createFileRoute("/_app/history")({
  component: HistoryRoute,
  head: () => ({
    meta: [{ title: "History" }],
  }),
  validateSearch: z.object({
    /** Words every chat shown has in it. */
    q: z.coerce.string().optional().catch(undefined),
    /** Only the chats and drafts filed under this project. */
    project: z.string().optional().catch(undefined),
    /** Every chat, open or not, and no drafts. */
    show: z.literal("chats").optional().catch(undefined),
  }),
});

function HistoryRoute() {
  const { project, q, show } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HistoryPage
      onSearch={(next) => {
        void navigate({
          replace: true,
          search: {
            ...(project ? { project } : {}),
            ...(next ? { q: next } : {}),
            ...(show ? { show } : {}),
          },
        });
      }}
      {...(project ? { project } : {})}
      q={q ?? ""}
      show={show}
    />
  );
}
