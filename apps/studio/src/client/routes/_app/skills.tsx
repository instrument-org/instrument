import { BuiltInPage } from "@/client/components/settings/built-in-page";
import {
  SettingsAskContext,
  useArrivingAsk,
} from "@/client/components/settings/settings-ask";
import { ARRIVING_SEARCH } from "@/client/components/settings/settings-href";
import { SkillsSection } from "@/client/components/settings/skills-section";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/** Skills, as a page of its own: the skills tasks can use, and making one. */
export const Route = createFileRoute("/_app/skills")({
  component: SkillsRoute,
  head: () => ({
    meta: [{ title: "Skills" }],
  }),
  validateSearch: z.object(ARRIVING_SEARCH),
});

function SkillsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const ask = useArrivingAsk(search, () => {
    void navigate({ replace: true, search: {} });
  });
  return (
    <SettingsAskContext value={ask}>
      <BuiltInPage ask={ask}>
        <SkillsSection />
      </BuiltInPage>
    </SettingsAskContext>
  );
}
