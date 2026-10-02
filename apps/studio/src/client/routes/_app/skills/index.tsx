import { SkillList } from "@/client/components/skills/skill-list";
import { useOnScreen } from "@/client/components/window/on-screen";
import { APP_NAME } from "@instrument-org/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

/**
 * The Skills screen: every skill a task can load, grouped by where it comes
 * from, each a row that opens the skill's page. A place to see what the
 * conversation's tasks know how to do and where each piece of that came
 * from; a skill is used by asking for the work, never from here.
 */
export const Route = createFileRoute("/_app/skills/")({
  component: SkillsRoute,
});

function SkillsRoute() {
  useOnScreen({ screen: "skills" });
  const navigate = useNavigate();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-6 pb-10">
      <h1 className="text-xl font-semibold">Skills</h1>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">
        {`What ${APP_NAME} knows how to do beyond the basics, and where each skill comes from.`}
      </p>

      <div className="mt-6 max-w-5xl">
        <SkillList
          onOpen={(skill) => {
            void navigate({
              params: { name: skill.id },
              to: "/skills/$name",
            });
          }}
        />
      </div>
    </div>
  );
}
