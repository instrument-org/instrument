import { Kbd, KbdGroup } from "@/client/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import {
  ORCHESTRATOR_SHORTCUTS,
  type OrchestratorShortcutId,
} from "@/shared/orchestrator-shortcuts";
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
 * is none to show. Given with a chord, it names the control in the words the
 * control has for its state ("Hide the inbox") while the chord stays the
 * table's.
 *
 * `chord` is the 2.0 window's table, whose chords the classic window's has
 * no entry for.
 *
 * Opens faster than the app default; the whole row is on the path to everything
 * else.
 */
export function ToolbarTooltip({
  children,
  chord,
  label,
  shortcut,
}: {
  children: React.ReactNode;
  chord?: OrchestratorShortcutId;
  label?: string;
  shortcut?: ShortcutId;
}) {
  const entry = shortcut
    ? SHORTCUTS[shortcut]
    : chord
      ? ORCHESTRATOR_SHORTCUTS[chord]
      : undefined;
  const text = label ?? entry?.label ?? "";

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
