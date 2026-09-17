import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { Button } from "@/client/components/ui/button";
import { toolbarClassName } from "@/client/components/ui/toggle";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";

/**
 * Opens and closes the pane of tabs beside a thread or a draft, the way a
 * task's page keeps its pane: one control in two places rather than two
 * controls. The head over the conversation holds it while the pane is
 * closed, and the pane's own tab strip holds it while it is open. Both are
 * flush with the window's right edge, so it lands on the same pixel either
 * way and pressing it again and again never moves the pointer.
 *
 * Rotated, because the icon draws a left-hand sidebar and this is the pane
 * on the right.
 */
export function PaneToggle({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  const label = isOpen ? "Close panel" : "Open panel";
  return (
    <ToolbarTooltip label={label}>
      <Button
        aria-label={label}
        className={toolbarClassName({ className: "shrink-0", pressed: false })}
        onClick={onToggle}
        size="icon-sm"
        variant="ghost"
      >
        <SidebarSimpleIcon className="size-4 rotate-180" />
      </Button>
    </ToolbarTooltip>
  );
}
