import { BuiltInPage } from "@/client/components/settings/built-in-page";
import { MemorySection } from "@/client/components/settings/memory-section";
import {
  SettingsAskContext,
  useArrivingAsk,
} from "@/client/components/settings/settings-ask";
import { ARRIVING_SEARCH } from "@/client/components/settings/settings-href";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Memory, as a page of its own: what Instrument remembers, one file per
 * memory, and importing from another AI. A link to a memory no file has any
 * more arrives here with its name (`?memory=`), and a link to a row of it
 * with the row (`?setting=`), each taken once.
 */
export const Route = createFileRoute("/_app/memory")({
  component: MemoryRoute,
  head: () => ({
    meta: [{ title: "Memory" }],
  }),
  validateSearch: z.object(ARRIVING_SEARCH),
});

function MemoryRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const ask = useArrivingAsk(search, () => {
    void navigate({ replace: true, search: {} });
  });
  return (
    <SettingsAskContext value={ask}>
      <BuiltInPage ask={ask}>
        <MemorySection />
      </BuiltInPage>
    </SettingsAskContext>
  );
}
