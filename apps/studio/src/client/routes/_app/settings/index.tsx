import { SCREENS } from "@/shared/instrument-screens";
import { createFileRoute, redirect } from "@tanstack/react-router";

/** Settings with no part named opens at its first part, General. */
export const Route = createFileRoute("/_app/settings/")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `${SCREENS.settings.href}${location.searchStr}`,
      replace: true,
    });
  },
});
