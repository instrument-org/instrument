import { SkillLink } from "@/client/components/skill-link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { cn } from "@/client/lib/utils";
import { type RPCOutput, rpcClient } from "@/client/rpc/client";
import { skillMentionLabel } from "@instrument-org/shared/skill-mention";
import { useQuery } from "@tanstack/react-query";

type SkillSummary = RPCOutput["workspace"]["skill"]["list"][number];

/**
 * One `/name` on screen: what it does, on hover, and a way to its page.
 *
 * Shared by the transcript and the composer's chip, so a mention reads and
 * behaves the same before and after the message is sent. `resolved` says whether
 * the caller has a skill list to judge against at all -- without one, a name it
 * cannot find is unknown rather than gone.
 */
export function SkillMention({
  name,
  resolved,
  summary,
  tabIndex,
}: {
  name: string;
  resolved: boolean;
  summary?: Pick<SkillSummary, "description" | "id" | "name" | "title">;
  tabIndex?: number;
}) {
  const label = skillMentionLabel(summary?.name ?? name);

  // A mention can outlive its skill: renamed or deleted, or in a workspace no
  // longer read. The list is the same source the composer offers mentions from,
  // so once it has loaded, a name it does not carry has no page to reach.
  // Linking there only dead-ends, so leave the token inert but still legible as
  // the mention the user wrote. Until the list resolves it stays a link, since
  // the far more common case is a skill that is simply present.
  if (resolved && !summary) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={SKILL_TOKEN_CLASS_NAME}>{label}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          This skill is no longer available in this workspace.
        </TooltipContent>
      </Tooltip>
    );
  }

  const link = (
    <SkillLink
      className={cn(SKILL_TOKEN_CLASS_NAME, "hover:underline")}
      name={name}
      tabIndex={tabIndex}
    >
      {label}
    </SkillLink>
  );

  if (!summary) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{summary.title}</p>
        <p className="mt-0.5 font-mono text-popover-foreground/70">
          {skillMentionLabel(summary.id)}
        </p>
        {summary.description ? (
          <p className="mt-0.5 text-popover-foreground/70">
            {summary.description}
          </p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Every skill the workspace has, by each name a mention may carry: its
 * aliases and its qualified name. Every skill, not only the ones a slash
 * offers, since a mention can name one the menu leaves out (Settings drafts
 * "Use /skill-creator to change /<skill>" for any skill). `isSuccess` is
 * what `SkillMention`'s `resolved` wants.
 */
export function useSkillsByName(enabled = true) {
  const { data: skills = [], isSuccess } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      enabled,
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );
  const byName = new Map(
    skills.flatMap((skill) => [
      ...skill.aliases.map((alias) => [alias, skill] as const),
      [skill.qualifiedName, skill] as const,
    ]),
  );
  return { byName, isSuccess };
}

/**
 * A mention resolved by name against every skill the workspace has, the way
 * the transcript resolves one: the composer's chip, so a draft and the message
 * it becomes agree on whether the skill is there.
 */
export function SkillMentionByName({
  name,
  tabIndex,
}: {
  name: string;
  tabIndex?: number;
}) {
  const { byName, isSuccess } = useSkillsByName();
  return (
    <SkillMention
      name={name}
      resolved={isSuccess}
      summary={byName.get(name)}
      tabIndex={tabIndex}
    />
  );
}
