import { shortcutGuideModalAtom } from "@/client/atoms/shortcut-guide-modal";
import { FuzzyHighlight } from "@/client/components/fuzzy-highlight";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Kbd, KbdGroup } from "@/client/components/ui/kbd";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { useShortcutGuideHotkey } from "@/client/hooks/use-shortcut-guide-hotkey";
import { formatAccelerator } from "@/client/lib/format-accelerator";
import {
  matchShortcuts,
  type ShortcutMatch,
} from "@/client/lib/shortcut-search";
import {
  SHORTCUT_GUIDE_ENTRIES,
  SHORTCUT_GUIDE_GROUPS,
} from "@/shared/shortcut-guide";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useAtom } from "jotai";
import { alphabetical } from "radashi";
import { useState } from "react";

/**
 * The guide to every chord the window answers to, mounted once at the window
 * root, which is also where `?` is listened for. Reads
 * `shortcutGuideModalAtom` (opened by `?` or the Help menu).
 * Rows are grouped and searchable; chords are drawn for this platform from the
 * same tables the native menu builds its accelerators from, so nothing here
 * can go stale. Traps tab navigation while open.
 */
export function ShortcutGuideModal() {
  const [state, setState] = useAtom(shortcutGuideModalAtom);
  const isOpen = state !== null;
  const { content, onExitComplete, openKey } = useDeferredModalState(state);

  useShortcutGuideHotkey();
  useBlockTabNavigation(isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setState(null);
        }
      }}
      open={isOpen}
    >
      {content !== null && (
        <ShortcutGuideContent key={openKey} onExitComplete={onExitComplete} />
      )}
    </Dialog>
  );
}

function ShortcutGuideContent({
  onExitComplete,
}: {
  onExitComplete: () => void;
}) {
  const [query, setQuery] = useState("");
  const isDeveloperMode = useDeveloperMode();

  // The Developer menu, and so its chords, exist only in developer mode.
  const entries = SHORTCUT_GUIDE_ENTRIES.filter(
    ({ group }) => isDeveloperMode || group !== "Developer",
  );
  const matches = matchShortcuts(entries, query);
  const sections = SHORTCUT_GUIDE_GROUPS.map((group) => ({
    group,
    // A query orders rows by how well they matched; without one there's no
    // ranking to preserve, and the tables' key order is only lint's opinion.
    matches: query
      ? matches.filter((match) => match.entry.group === group)
      : alphabetical(
          matches.filter((match) => match.entry.group === group),
          (match) => match.entry.label,
        ),
  })).filter((section) => section.matches.length > 0);

  return (
    <DialogContent
      className="grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0"
      maxWidth="38rem"
      onExitComplete={onExitComplete}
    >
      <div className="flex flex-col gap-3 px-6 pt-6 pb-4">
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">
          Every keyboard shortcut the app offers, grouped and searchable.
        </DialogDescription>
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            className="pl-9"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search shortcuts"
            value={query}
          />
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-3">
        {sections.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No shortcuts match “{query}”
          </p>
        ) : (
          sections.map((section) => (
            <section className="pb-2" key={section.group}>
              <h3 className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                {section.group}
              </h3>
              {section.matches.map((match) => (
                <ShortcutRow key={match.entry.id} match={match} />
              ))}
            </section>
          ))
        )}
      </div>
    </DialogContent>
  );
}

function ShortcutRow({ match }: { match: ShortcutMatch }) {
  return (
    <div
      className="flex items-center justify-between gap-6 rounded-lg px-3 py-1.5"
      data-testid="shortcut-row"
    >
      <span className="min-w-0 truncate text-sm">
        <FuzzyHighlight ranges={match.labelRanges} text={match.entry.label} />
      </span>
      <KbdGroup>
        {formatAccelerator(match.entry.accelerator).map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
    </div>
  );
}
