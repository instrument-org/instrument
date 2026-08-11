import { Badge } from "@/client/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { isProvidedSource, type SkillSource } from "@/client/lib/skill-source";
import { APP_NAME } from "@instrument-org/shared";

interface BadgedSkill {
  modelInvocable: boolean;
  source: SkillSource;
  userInvocable: boolean;
}

const SKILL_BADGES = [
  {
    active: (skill: BadgedSkill) => !skill.userInvocable,
    label: "Automatic",
    tooltip: (skill: BadgedSkill) =>
      isProvidedSource(skill.source)
        ? `${APP_NAME} loads the skills it ships when they fit the work, so they stay out of the slash menu and other direct pickers.`
        : "Set by `user-invocable: false` in the frontmatter. This keeps the skill out of the slash menu and other direct pickers, so it is only available for automatic use.",
    variant: "outline",
  },
  {
    active: (skill: BadgedSkill) => !skill.modelInvocable,
    label: "User invoked",
    tooltip: () =>
      "Set by `disable-model-invocation: true` in the frontmatter. This keeps the skill from being loaded automatically, so someone has to choose it on purpose.",
    variant: "outline",
  },
] as const;

export function SkillBadges({
  className,
  skill,
}: {
  className?: string;
  skill: BadgedSkill;
}) {
  const badges = getSkillBadges(skill);
  if (badges.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      {badges.map((badge) => (
        <Tooltip key={badge.label}>
          <TooltipTrigger asChild>
            <span>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </span>
          </TooltipTrigger>
          <TooltipContent>{badge.tooltip(skill)}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function getSkillBadges(skill: BadgedSkill) {
  return SKILL_BADGES.filter((badge) => badge.active(skill));
}
