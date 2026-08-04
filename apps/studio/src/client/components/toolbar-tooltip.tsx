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
 * accessible name, since these are unlabelled icons.
 *
 * Opens faster than the app default; the whole row is on the path to everything
 * else.
 */
export function ToolbarTooltip({
  children,
  shortcut,
}: {
  children: React.ReactNode;
  shortcut: ShortcutId;
}) {
  const { accelerator, label } = SHORTCUTS[shortcut];

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger aria-label={label} asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2" side="bottom">
        {label}
        <KbdGroup>
          {formatAccelerator(accelerator).map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  );
}
