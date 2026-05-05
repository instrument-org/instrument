import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react";

import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { ToolCard, ToolCardHeader, ToolCardSection } from "./tool-card";

export function ToolUnavailable({
  part,
}: {
  part: SessionMessagePart.ToolPart & { type: "tool-unavailable" };
}) {
  const prettyJson = tryPrettyJson(part);

  const { highlightedHtml } = useSyntaxHighlighting({
    code: prettyJson ?? undefined,
    language: "json",
  });

  return (
    <ToolCard>
      <ToolCardHeader className="flex items-center gap-2">
        <WarningIcon className="size-3 shrink-0 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground">
          Tool did not match known tools
        </p>
      </ToolCardHeader>

      {prettyJson && (
        <ToolCardSection copyText={prettyJson} maxHeight="max-h-64">
          {highlightedHtml ? (
            <div
              className="font-mono text-xs [&_.shiki]:bg-transparent [&_pre]:break-all [&_pre]:whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
            />
          ) : (
            <pre className="font-mono text-xs break-all whitespace-pre-wrap">
              {prettyJson}
            </pre>
          )}
        </ToolCardSection>
      )}
    </ToolCard>
  );
}

function tryPrettyJson(value: unknown): null | string {
  if (value == null) {
    return null;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}
