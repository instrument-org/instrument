import { Kbd, KbdGroup } from "@/client/components/ui/kbd";

/**
 * The hint bar every screen ends with.
 *
 * One component so the bar does not move or change shape as you step between
 * screens -- the panel should read as one surface you are navigating inside of,
 * and a footer that reflows on every step is the fastest way to lose that.
 *
 * Right-aligned, and no Escape hint anywhere: going back is the one thing the
 * key does everywhere in the panel, and repeating it on every screen spends the
 * bar on something nobody needs telling twice.
 */
export function OverlayFooter({
  hints,
}: {
  hints: { keys: string[]; label: string }[];
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-4 border-t border-border px-3 py-2">
      {hints.map((hint) => (
        <span
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          key={hint.label}
        >
          {hint.label}
          <KbdGroup>
            {hint.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
        </span>
      ))}
    </div>
  );
}
