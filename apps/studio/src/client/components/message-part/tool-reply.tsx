import { type SessionMessagePart } from "@instrument-org/workspace/client";

type ReplyPart = Extract<SessionMessagePart.ToolPart, { type: "tool-reply" }>;

/**
 * What the orchestrator said to the user. Drawn as prose rather than as a tool
 * row, because to the reader it is the message: the call is only how the
 * harness keeps every reply short and knows which text was meant for them.
 */
export function ToolReply({ part }: { part: ReplyPart }) {
  const text = part.input?.text;
  if (!text) {
    return null;
  }
  const link = part.input?.link;

  return (
    <div className="flex flex-col items-start gap-1">
      <p className="w-full text-[15px]/[1.5] whitespace-pre-wrap">{text}</p>
      {link ? (
        <span className="font-mono text-xs text-muted-foreground">{link}</span>
      ) : null}
    </div>
  );
}
