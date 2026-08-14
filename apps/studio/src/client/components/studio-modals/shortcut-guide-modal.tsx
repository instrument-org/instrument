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
import { formatAccelerator } from "@/client/lib/format-accelerator";
import {
  matchShortcuts,
  type ShortcutMatch,
} from "@/client/lib/shortcut-search";
import { SHORTCUT_ENTRIES, SHORTCUT_GROUPS } from "@/shared/shortcuts";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/MagnifyingGlass";
import { useAtom } from "jotai";
import { alphabetical } from "radashi";
import { useState } from "react";

/**
 * App-wide guide to every shortcut in the shared table, mounted once at the
 * app-chrome root. Reads `shortcutGuideModalAtom` (opened by `?`, the Help
 * menu, or `openShortcutGuide`). Rows are grouped and searchable; chords are
 * rendered for this platform from the same descriptors the native menu builds
 * its accelerators from, so nothing here can go stale. Traps tab navigation
 * while open.
 */
export function ShortcutGuideModal() {
  const [state, setState] = useAtom(shortcutGuideModalAtom);
  const isOpen = state !== null;
  const { content, onExitComplete, openKey } = useDeferredModalState(state);

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

  const entries = SHORTCUT_ENTRIES.filter(
    ({ descriptor }) => isDeveloperMode || descriptor.group !== "Developer",
  );
  const matches = matchShortcuts(entries, query);
  const sections = SHORTCUT_GROUPS.map((group) => ({
    group,
    // A query orders rows by how well they matched; without one there's no
    // ranking to preserve, and the table's key order is only lint's opinion.
    matches: query
      ? matches.filter((match) => match.descriptor.group === group)
      : alphabetical(
          matches.filter((match) => match.descriptor.group === group),
          (match) => match.descriptor.label,
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
                <ShortcutRow key={match.id} match={match} />
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
        <FuzzyHighlight
          ranges={match.labelRanges}
          text={match.descriptor.label}
        />
      </span>
      <KbdGroup>
        {formatAccelerator(match.descriptor.accelerator).map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
    </div>
  );
}
