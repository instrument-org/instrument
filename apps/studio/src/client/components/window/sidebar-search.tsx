import { SoftKey } from "@/client/components/soft-key";
import { commandMenuOpenAtom } from "@/client/atoms/command-menu";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useSetAtom } from "jotai";

/**
 * The sidebar's first row: a search field to look at, with the command
 * menu's key at its end, which opens the command menu when pressed. The
 * menu's own field is the one typed into.
 */
export function SidebarSearch() {
  const setMenuOpen = useSetAtom(commandMenuOpenAtom);
  return (
    <div className="shrink-0 pb-1.5">
      <button
        className="relative flex h-9 w-full min-w-0 cursor-default items-center gap-2 rounded-lg border border-transparent bg-foreground/4 pr-2 pl-8 text-[13px] text-muted-foreground outline-hidden hover:bg-foreground/6 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        onClick={() => {
          setMenuOpen(true);
        }}
        type="button"
      >
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2" />
        <span className="min-w-0 flex-1 truncate text-left">Search</span>
        <SoftKey>
          {formatAcceleratorText(WINDOW_SHORTCUTS.commandMenu.accelerator)}
        </SoftKey>
      </button>
    </div>
  );
}
