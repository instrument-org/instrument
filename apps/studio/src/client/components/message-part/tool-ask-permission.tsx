import { type SessionMessagePart } from "@instrument-org/workspace/client";

import { StepSentence } from "./step-sentence";

/**
 * A permission ask the agent got wrong, refused with nothing for the person
 * to do. One blocked for a reason they read opens from its step alone, and
 * one that raised a card is whole in the card over the reply box.
 */
export function ToolAskPermission({
  part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-ask_permission" };
}) {
  if (part.state !== "output-available" || part.output.state !== "refused") {
    return null;
  }
  return <StepSentence>This step didn't work.</StepSentence>;
}
