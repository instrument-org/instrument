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
  singleLine = false,
}: {
  className?: string;
  command: string;
  /**
   * Clamp to one line, ending in an ellipsis.
   *
   * For the places that are showing which command this is rather than the
   * command itself: a `node -e` one-liner is hundreds of characters, and left
   * to run it takes the surface it is on with it.
   */
  singleLine?: boolean;
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
          className={cn(
            "min-w-0 [&_.shiki]:bg-transparent",
            singleLine &&
              "overflow-hidden [&_.line]:block [&_.line]:truncate [&_pre]:overflow-hidden",
          )}
          dangerouslySetInnerHTML={{ __html: highlightedHtml.join("\n") }}
        />
      ) : (
        <pre className={cn("min-w-0", singleLine && "truncate")}>{command}</pre>
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
