import { useGroupTab } from "@/client/components/window/group-tab";
import { SoftKey } from "@/client/components/window/sidebar-search";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { cn } from "@/client/lib/utils";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";

/**
 * The keys that put the keyboard in a search field, at the field's end while
 * it is empty and the keyboard is elsewhere. The caller's box is `relative`
 * and a `group/field`, and renders this only while the field is empty. Find
 * goes to the side of a tab group with the keyboard, so its keys show on that
 * side alone.
 */
export function FieldKeys({
  chord = "findInPage",
  className,
}: {
  chord?: "findInPage" | "searchChats";
  className?: string;
}) {
  const groupTab = useGroupTab();
  if (chord === "findInPage" && groupTab?.hasKeyboard === false) {
    return null;
  }
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute top-1/2 right-2 flex -translate-y-1/2 group-focus-within/field:hidden",
        className,
      )}
      data-field-keys=""
    >
      <SoftKey>
        {formatAcceleratorText(WINDOW_SHORTCUTS[chord].accelerator)}
      </SoftKey>
    </span>
  );
}
