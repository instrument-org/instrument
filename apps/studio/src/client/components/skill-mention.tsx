import { InternalLink } from "@/client/components/internal-link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { skillMentionLabel } from "@instrument-org/shared/skill-mention";

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
  summary?: Pick<SkillSummary, "description" | "title">;
  tabIndex?: number;
}) {
  const label = skillMentionLabel(name);

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
    <InternalLink
      className={cn(SKILL_TOKEN_CLASS_NAME, "hover:underline")}
      params={{ name }}
      tabIndex={tabIndex}
      to="/skills/$name"
    >
      {label}
    </InternalLink>
  );

  if (!summary) {
    return link;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{summary.title}</p>
        {summary.description ? (
          <p className="mt-0.5 text-background/70">{summary.description}</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
