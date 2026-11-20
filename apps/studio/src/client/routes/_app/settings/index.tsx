import { SCREENS } from "@/shared/instrument-screens";
import { createFileRoute, redirect } from "@tanstack/react-router";

/** Settings with no part named opens at its first part, General. */
export const Route = createFileRoute("/_app/settings/")({
  beforeLoad: ({ location }) => {
    // oxlint-disable-next-line typescript/only-throw-error
    throw redirect({
      href: `${SCREENS.settings.href}${location.searchStr}`,
      replace: true,
    });
  },
});
