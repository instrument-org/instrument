import { Kbd, KbdGroup } from "@/client/components/ui/kbd";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { SHORTCUTS } from "@/shared/shortcuts";

export function CommandMenuCTA() {
  return (
    <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      Press
      <KbdGroup>
        {formatAccelerator(SHORTCUTS.commandMenu.accelerator).map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
      to quickly switch tasks
    </p>
  );
}
