import { SkillDetail } from "@/client/components/skills/skill-detail";
import { useOnScreen } from "@/client/components/window/on-screen";
import { rpcClient } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

/**
 * One skill's page. The conversation is told which skill is up, so work
 * asked for from here that the skill fits goes to a task told to load it.
 */
export const Route = createFileRoute("/_app/skills/$name")({
  component: SkillRoute,
});

function SkillRoute() {
  const { name } = Route.useParams();
  const { data: skill } = useQuery(
    rpcClient.workspace.skill.byName.queryOptions({ input: { name } }),
  );
  useOnScreen({
    screen: "skills",
    ...(skill
      ? {
          skill: {
            description: skill.description,
            name: skill.id,
            title: skill.title,
          },
        }
      : {}),
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-6 pb-10">
      <SkillDetail name={name} />
    </div>
  );
}
