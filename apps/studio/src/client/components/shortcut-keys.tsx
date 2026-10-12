import { Fragment } from "react";
import { Kbd, KbdGroup } from "@/client/components/ui/kbd";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import { isMacOS } from "@/client/lib/utils";
import type { ShortcutAccelerator } from "@/shared/shortcuts";

/**
 * One key cap per key. macOS sets its symbol caps side by side (`⇧` `⌘` `T`);
 * elsewhere the caps are words, so a plus goes between them as Windows and
 * Linux write it (`Ctrl` + `Shift` + `T`).
 */
export function ShortcutKeys({
  accelerator,
}: {
  accelerator: ShortcutAccelerator;
}) {
  const separated = !isMacOS();
  return (
    <KbdGroup>
      {formatAccelerator(accelerator).map((key, index) => (
        <Fragment key={key}>
          {separated && index > 0 ? (
            <span aria-hidden className="text-xs text-muted-foreground">
              +
            </span>
          ) : null}
          <Kbd>{key}</Kbd>
        </Fragment>
      ))}
    </KbdGroup>
  );
}
