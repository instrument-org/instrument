import { Kbd, KbdGroup } from "@/client/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { type ShortcutAccelerator } from "@/shared/shortcuts";

/**
 * Label-and-shortcut tooltip for the toolbar's icon controls, so chrome that
 * reads as one row of buttons also reads as one tooltip style. Opens faster
 * than the app default: these are unlabelled icons, and the whole row is on the
 * path to everything else.
 */
export function ToolbarTooltip({
  accelerator,
  children,
  label,
}: {
  accelerator: ShortcutAccelerator;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
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
