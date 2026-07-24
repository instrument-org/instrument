import { Badge } from "@/client/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";

const SKILL_BADGES = [
  {
    active: (skill: { userInvocable: boolean }) => !skill.userInvocable,
    label: "Hidden",
    tooltip:
      "Set by `user-invocable: false` in the frontmatter. This keeps the skill out of the slash menu and other direct pickers.",
    variant: "outline",
  },
  {
    active: (skill: { modelInvocable: boolean }) => !skill.modelInvocable,
    label: "User invoked",
    tooltip:
      "Set by `disable-model-invocation: true` in the frontmatter. This keeps the skill from being loaded automatically, so someone has to choose it on purpose.",
    variant: "outline",
  },
] as const;

export function SkillBadges({
  className,
  skill,
}: {
  className?: string;
  skill: {
    modelInvocable: boolean;
    userInvocable: boolean;
  };
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
          <TooltipContent>{badge.tooltip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

function getSkillBadges(skill: {
  modelInvocable: boolean;
  userInvocable: boolean;
}) {
  return SKILL_BADGES.filter((badge) => badge.active(skill));
}
