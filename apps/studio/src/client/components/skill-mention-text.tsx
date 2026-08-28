import { InlineLink } from "@/client/components/inline-link";
import { SkillMention } from "@/client/components/skill-mention";
import { SKILL_LIST_STALE_TIME_MS } from "@/client/lib/skill-query";
import { splitMessageText } from "@/client/lib/skill-text";
import { rpcClient } from "@/client/rpc/client";
import { skillMentionLabel } from "@instrument-org/shared/skill-mention";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";

/**
 * A sent message, with skill mentions shown the way the composer showed them.
 *
 * Deliberately not the composer's ProseMirror view: the transcript is a long
 * scrolling list, and it needs to read a token, not edit one. The two share the
 * parse and the token itself instead. Newlines are emitted as text, so the
 * caller's `whitespace-pre-wrap` still governs wrapping.
 *
 * A `/name` the user typed or pasted past the menu ("use /release to ship")
 * reads as the same reference, so it becomes the same token once the skill list
 * confirms a skill by that name -- unlike the composer's own token, a bare word
 * is only a guess until then.
 */
export function SkillMentionText({ text }: { text: string }) {
  const lines = text.split("\n").map((line) => splitMessageText(line));
  // The list is only wanted to resolve and describe the tokens, so leave it
  // unfetched for the many messages that reference no skill at all. A link is
  // not one: it is drawn from itself and asks the workspace nothing.
  const hasReferences = lines
    .flat()
    .some((segment) => segment.type === "skill" || segment.type === "slash");
  const { data: skills = [], isSuccess } = useQuery(
    rpcClient.workspace.skill.list.queryOptions({
      enabled: hasReferences,
      staleTime: SKILL_LIST_STALE_TIME_MS,
    }),
  );
  const byName = new Map(
    skills.flatMap((skill) => [
      ...skill.aliases.map((alias) => [alias, skill] as const),
      [skill.qualifiedName, skill] as const,
    ]),
  );

  return lines.map((segments, lineIndex) => (
    <Fragment key={lineIndex}>
      {lineIndex > 0 ? "\n" : null}
      {segments.map((segment, segmentIndex) => {
        if (segment.type === "text") {
          return <Fragment key={segmentIndex}>{segment.text}</Fragment>;
        }
        if (segment.type === "link") {
          return (
            <InlineLink
              href={segment.href}
              key={segmentIndex}
              label={segment.label}
            />
          );
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
