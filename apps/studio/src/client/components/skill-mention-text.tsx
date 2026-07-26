import { InternalLink } from "@/client/components/internal-link";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { splitSkillText } from "@/client/lib/skill-text";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { skillMentionLabel } from "@instrument-org/shared/skill-mention";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

type SkillSummary = RPCOutput["workspace"]["skill"]["list"][number];

/**
 * A sent message, with skill mentions shown the way the composer showed them.
 *
 * Deliberately not the composer's ProseMirror view: the transcript is a long
 * scrolling list, and it needs to read a token, not edit one. The two share the
 * parse instead. Here the token also links to its skill page, so a mention the
 * user reached for stays a way back to it. Newlines are emitted as text, so the
 * caller's `whitespace-pre-wrap` still governs wrapping.
 *
 * A `/name` the user typed or pasted past the menu ("use /release to ship")
 * reads as the same reference, so it becomes the same token once the skill list
 * confirms a skill by that name -- unlike the composer's own token, a bare word
 * is only a guess until then.
 */
export function SkillMentionText({ text }: { text: string }) {
  const lines = text.split("\n").map((line) => splitSkillText(line));
  // The list is only wanted to resolve and describe the tokens, so leave it
  // unfetched for the many messages that reference no skill at all.
  const hasReferences = lines.flat().some((segment) => segment.type !== "text");
  const { data: skills = [], isSuccess } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      enabled: hasReferences,
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  return lines.map((segments, lineIndex) => (
    <Fragment key={lineIndex}>
      {lineIndex > 0 ? "\n" : null}
      {segments.map((segment, segmentIndex) => {
        if (segment.type === "text") {
          return <Fragment key={segmentIndex}>{segment.text}</Fragment>;
        }
        const summary = byName.get(segment.name);
        // A bare word is only a skill reference if a skill answers to it as a
        // slash command. Anything else -- a nonexistent name, a skill the agent
        // loads on its own, or a name from another tool entirely -- is just text
        // the user wrote, and linking it would invent a claim they never made.
        if (segment.type === "slash" && !summary?.userInvocable) {
          return (
            <Fragment key={segmentIndex}>
              {skillMentionLabel(segment.name)}
            </Fragment>
          );
        }
        return (
          <SkillMention
            key={segmentIndex}
            name={segment.name}
            resolved={isSuccess}
            summary={summary}
          />
        );
      })}
    </Fragment>
  ));
}

function SkillMention({
  name,
  resolved,
  summary,
}: {
  name: string;
  resolved: boolean;
  summary?: SkillSummary;
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
