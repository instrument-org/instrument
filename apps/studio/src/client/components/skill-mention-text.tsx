import {
  SKILL_TOKEN_CLASS_NAME,
  skillTokenLabel,
  splitSkillTokens,
} from "@/client/lib/skill-tokens";
import { Fragment } from "react";

/**
 * A sent message, with skill mentions shown the way the composer showed them.
 *
 * Deliberately not the composer's ProseMirror view: the transcript is a long
 * scrolling list, and it needs to read a token, not edit one. The two share the
 * parse instead. Newlines are emitted as text, so the caller's
 * `whitespace-pre-wrap` still governs wrapping.
 */
export function SkillMentionText({ text }: { text: string }) {
  return text.split("\n").map((line, lineIndex) => (
    <Fragment key={lineIndex}>
      {lineIndex > 0 ? "\n" : null}
      {splitSkillTokens(line).map((segment, segmentIndex) =>
        segment.type === "skill" ? (
          <span className={SKILL_TOKEN_CLASS_NAME} key={segmentIndex}>
            {skillTokenLabel(segment.name)}
          </span>
        ) : (
          <Fragment key={segmentIndex}>{segment.text}</Fragment>
        ),
      )}
    </Fragment>
  ));
}
