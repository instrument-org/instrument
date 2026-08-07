import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { GroupHeading } from "./group-heading";
import { isActivityHeadingVisible } from "./tool-call-utils";

type StartActivityPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-start_activity" }
>;

/**
 * The heading of a group the agent named itself.
 *
 * Nothing but a `GroupHeading` fed from the call's own title: a declared group
 * and an inferred one read the same way, and only differ in where the words
 * come from. A title is absent until the first tokens arrive, and a model can
 * call the tool with a blank one, so a heading with nothing to say draws
 * nothing -- the same rule the layout uses to decide whether the call opens a
 * group at all.
 */
export function ToolStartActivity({
  isRunning,
  part,
}: {
  isRunning: boolean;
  part: StartActivityPart;
}) {
  if (!isActivityHeadingVisible(part)) {
    return null;
  }
  return <GroupHeading isRunning={isRunning} title={part.input?.title ?? ""} />;
}
