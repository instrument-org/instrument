import { InternalLink } from "@/client/components/internal-link";
import { SKILL_TOKEN_CLASS_NAME } from "@/client/lib/skill-tokens";
import { cn } from "@/client/lib/utils";
import {
  skillMentionLabel,
  splitSkillMention,
} from "@instrument-org/shared/skill-mention";
import { Fragment } from "react";

/**
 * A sent message, with skill mentions shown the way the composer showed them.
 *
 * Deliberately not the composer's ProseMirror view: the transcript is a long
 * scrolling list, and it needs to read a token, not edit one. The two share the
 * parse instead. Here the token also links to its skill page, so a mention the
 * user reached for stays a way back to it. Newlines are emitted as text, so the
 * caller's `whitespace-pre-wrap` still governs wrapping.
 */
export function SkillMentionText({ text }: { text: string }) {
  return text.split("\n").map((line, lineIndex) => (
    <Fragment key={lineIndex}>
      {lineIndex > 0 ? "\n" : null}
      {splitSkillMention(line).map((segment, segmentIndex) =>
        segment.type === "skill" ? (
          <InternalLink
            className={cn(SKILL_TOKEN_CLASS_NAME, "hover:underline")}
            key={segmentIndex}
            params={{ name: segment.name }}
            to="/skills/$name"
          >
            {skillMentionLabel(segment.name)}
          </InternalLink>
        ) : (
          <Fragment key={segmentIndex}>{segment.text}</Fragment>
        ),
      )}
    </Fragment>
  ));
}
