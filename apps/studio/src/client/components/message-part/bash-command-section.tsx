import { useSyntaxHighlighting } from "../../hooks/use-syntax-highlighting";
import { cn } from "../../lib/utils";
import { ToolCardSection } from "./tool-card";

/**
 * A shell command, drawn as one: a prompt, monospace, syntax highlighted.
 *
 * Shared so a command reads the same wherever it is shown. In proportional text
 * a program reads as a sentence about a program, and an unhighlighted one makes
 * the reader find the string boundaries themselves -- which is most of the work
 * in a `node -e "..."` one-liner.
 */
export function BashCommandPreview({
  className,
  command,
}: {
  className?: string;
  command: string;
}) {
  const { highlightedHtml } = useSyntaxHighlighting({
    code: command || undefined,
    language: "shellscript",
  });

  return (
    <div className={cn("flex font-mono text-sm leading-relaxed", className)}>
      <span className="mr-2 shrink-0 text-muted-foreground select-none">$</span>
      {/* A `<pre>` either way, highlighted or not, because that is what a
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
  );
}

/** The command on a `bash` card, with the card section's copy and wrap controls. */
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
  return (
    <ToolCardSection
      borderBottom={borderBottom}
      collapsedHeight={collapsedHeight}
      copyText={copyable ? command : undefined}
      wrappable
    >
      <BashCommandPreview command={command} />
    </ToolCardSection>
  );
}
