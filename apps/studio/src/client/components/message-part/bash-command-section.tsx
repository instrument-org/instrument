import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { ToolCardSection } from "./tool-card";

/**
 * A shell command, drawn the way the transcript draws one.
 *
 * Shared so the running-processes popover and a `bash` card show the same
 * thing: a prompt, the command syntax-highlighted, and the section's own copy
 * and wrap controls. A command shown anywhere else in plain proportional text
 * reads as a sentence about a program rather than as the program.
 */
export function BashCommandSection({
  borderBottom = false,
  collapsedHeight,
  command,
  copyable = true,
}: {
  borderBottom?: boolean;
  collapsedHeight: number;
  command: string;
  /** Off while the command is still arriving, when there is nothing final to copy. */
  copyable?: boolean;
}) {
  const { highlightedHtml } = useSyntaxHighlighting({
    code: command || undefined,
    language: "shellscript",
  });

  return (
    <ToolCardSection
      borderBottom={borderBottom}
      collapsedHeight={collapsedHeight}
      copyText={copyable ? command : undefined}
      wrappable
    >
      <div className="flex font-mono text-sm leading-relaxed">
        <span className="mr-2 shrink-0 text-muted-foreground select-none">
          $
        </span>
        {/* A `<pre>` either way, highlighted or not, because that is what the
            section's wrap toggle reaches for. */}
        {highlightedHtml ? (
          <div
            className="min-w-0 [&_.shiki]:bg-transparent"
            dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
          />
        ) : (
          <pre className="min-w-0">{command}</pre>
        )}
      </div>
    </ToolCardSection>
  );
}
