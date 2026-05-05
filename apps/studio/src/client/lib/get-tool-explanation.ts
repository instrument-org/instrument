import {
  type SessionMessagePart,
  TOOL_EXPLANATION_PARAM_NAME,
} from "@instrument-org/workspace/client";

export function getToolExplanation(
  part: SessionMessagePart.ToolPart,
): string | undefined {
  const input: unknown = part.input;

  if (
    !input ||
    typeof input !== "object" ||
    !(TOOL_EXPLANATION_PARAM_NAME in input)
  ) {
    return undefined;
  }

  const explanation = input[TOOL_EXPLANATION_PARAM_NAME];
  return typeof explanation === "string" && explanation.trim() !== ""
    ? explanation
    : undefined;
}
