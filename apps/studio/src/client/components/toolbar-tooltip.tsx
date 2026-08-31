import { Kbd, KbdGroup } from "@/client/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { type ShortcutId, SHORTCUTS } from "@/shared/shortcuts";

/**
 * Tooltip for the toolbar's icon controls: the shortcut table's own label and
 * chord, so a control reads the same here as it does in the native menu, the
 * command menu, and the shortcut guide. The label doubles as the button's
 * accessible name, since these are unlabeled icons.
 *
 * `label` covers a control the shortcut table has no entry for, so a toolbar
 * does not have to mix this with a bare `title` and end up with two kinds of
 * tooltip in one row. It names the control and shows no chord, because there
 * is none to show.
 *
 * Opens faster than the app default; the whole row is on the path to everything
 * else.
 */
export function ToolbarTooltip({
  children,
  label,
  shortcut,
}: {
  children: React.ReactNode;
  label?: string;
  shortcut?: ShortcutId;
}) {
  const entry = shortcut ? SHORTCUTS[shortcut] : undefined;
  const text = entry?.label ?? label ?? "";

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger aria-label={text} asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {text}
        {entry ? (
          <KbdGroup>
            {formatAccelerator(entry.accelerator).map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
