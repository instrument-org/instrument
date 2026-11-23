import { type SettingsTab } from "@/client/atoms/settings-modal";
import {
  SettingsAskContext,
  useArrivingAsk,
} from "@/client/components/settings/settings-ask";
import {
  ARRIVING_SEARCH,
  settingsHrefOf,
} from "@/client/components/settings/settings-href";
import { settingsTabOfSection } from "@/client/components/settings/settings-index";
import { SettingsPage } from "@/client/components/settings/settings-page";
import { isSettingsSection } from "@/shared/instrument-screens";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Settings, at one of its parts (`/settings/providers`). What it shows
 * besides the part is in its address too: the search, and once, as it
 * arrives, a row a link asked to light or a panel to open
 * (`ARRIVING_SEARCH`). Choosing a part is a step the tab's back returns
 * through; the search replaces the address as it is typed.
 */
export const Route = createFileRoute("/_app/settings/$section")({
  // A name that is no part of Settings is a link's name for a row, or words
  // to search for (`/settings/zoom`), and goes where that link goes.
  beforeLoad: ({ params }) => {
    if (!isSettingsSection(params.section)) {
      // oxlint-disable-next-line typescript/only-throw-error
      throw redirect({
        href: settingsHrefOf({ setting: params.section }),
        replace: true,
      });
    }
  },
  component: SettingsRoute,
  head: () => ({
    meta: [{ title: "Settings" }],
  }),
  validateSearch: z.object({
    ...ARRIVING_SEARCH,
    /** Words the search field holds. */
    q: z.coerce.string().optional().catch(undefined),
  }),
});

function SettingsRoute() {
  const { section } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const ask = useArrivingAsk(search, () => {
    void navigate({
      replace: true,
      search: ({ q }) => (q ? { q } : {}),
    });
  });
  const tab: SettingsTab = isSettingsSection(section)
    ? settingsTabOfSection(section)
    : "General";
  return (
    <SettingsAskContext value={ask}>
      <SettingsPage
        ask={ask}
        onSearch={(q) => {
          void navigate({
            replace: true,
            search: q ? { q } : {},
          });
        }}
        onSection={(next) => {
          void navigate({
            params: { section: next.toLowerCase() },
            search: ({ q }) => (q ? { q } : {}),
            to: "/settings/$section",
          });
        }}
        q={search.q ?? ""}
        section={tab}
      />
    </SettingsAskContext>
  );
}
