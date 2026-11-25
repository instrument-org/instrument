import { ARRIVING_SEARCH } from "@/client/components/settings/settings-href";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * An address an earlier build gave Memory, kept so a tab or a link saved at
 * it lands on Settings › Memory with what it asked.
 */
export const Route = createFileRoute("/_app/memory")({
  beforeLoad: ({ search }) => {
    throw redirect({
      params: { section: "memory" },
      replace: true,
      search,
      to: "/settings/$section",
    });
  },
  validateSearch: z.object(ARRIVING_SEARCH),
});
