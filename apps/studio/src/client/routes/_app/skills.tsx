import { ARRIVING_SEARCH } from "@/client/components/settings/settings-href";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * An address an earlier build gave Skills, kept so a tab or a link saved at
 * it lands on Settings › Skills with what it asked.
 */
export const Route = createFileRoute("/_app/skills")({
  beforeLoad: ({ search }) => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      params: { section: "skills" },
      replace: true,
      search,
      to: "/settings/$section",
    });
  },
  validateSearch: z.object(ARRIVING_SEARCH),
});
