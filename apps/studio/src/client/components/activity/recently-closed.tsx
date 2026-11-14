import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { appTabsAtom } from "@/client/components/window/app-tabs";
import { TabMark } from "@/client/components/window/row-half";
import { ShellContext } from "@/client/components/window/shell-context";
import {
  closedGroupTabOf,
  closedTabGroupOf,
} from "@/client/components/window/tab-model";
import { useTabTitle } from "@/client/components/window/tab-title";
import { RelativeTime } from "@/client/components/relative-time";
import { type ChatId } from "@instrument-org/workspace/client";
import { useAtomValue } from "jotai";
import { useContext } from "react";

const NO_TITLES = new Map<ChatId, string>();

/**
 * The tabs and tab groups this window closed lately, newest first, from the
 * list Shift+Cmd+T reopens: a card above the first day, a row each, which
 * brings that one back on a press. Nothing shows while the list is empty.
 */
export function RecentlyClosed() {
  const shell = useContext(ShellContext);
  const closed = useAtomValue(appTabsAtom).recentlyClosed;
  const appsBySlug = useAppsBySlug();
  const chatTitles = shell?.chatTitles ?? NO_TITLES;
  const titleOf = useTabTitle(chatTitles);
  const rows = closed.flatMap((entry) => {
    const group = closedTabGroupOf(entry);
    const tab = group?.[0] ?? closedGroupTabOf(entry);
    return tab ? [{ entry, size: group?.length ?? 0, tab }] : [];
  });
  if (!shell || rows.length === 0) {
    return null;
  }
  // A group says so, since its row names only its first tab.
  const kindOf = (size: number) =>
    size > 1 ? `Tab group of ${size}` : size === 1 ? "Tab group" : undefined;
  return (
    <section
      aria-label="Recently closed"
      className="mb-3 rounded-xl border border-border bg-card p-1.5"
    >
      <h2 className="px-2.5 pt-1 pb-1.5 text-xs font-medium text-muted-foreground">
        Recently closed
      </h2>
      {rows.map(({ entry, size, tab }) => (
        <ClosedRow
          closedAt={entry.closedAt}
          kind={kindOf(size)}
          key={entry.id}
          mark={
            <TabMark
              appsBySlug={appsBySlug}
              chatTitles={chatTitles}
              tab={tab}
            />
          }
          onReopen={() => {
            shell.reopenClosed(entry.id);
          }}
          title={titleOf(tab)}
        />
      ))}
    </section>
  );
}

function ClosedRow({
  closedAt,
  kind,
  mark,
  onReopen,
  title,
}: {
  closedAt: number | undefined;
  kind: string | undefined;
  mark: React.ReactNode;
  onReopen: () => void;
  title: string;
}) {
  return (
    <button
      className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] hover:bg-foreground/5"
      onClick={onReopen}
      type="button"
    >
      {mark}
      <span className="min-w-0 truncate font-medium text-foreground/85">
        {title}
      </span>
      {kind && <span className="shrink-0 text-muted-foreground">{kind}</span>}
      {closedAt !== undefined && (
        <RelativeTime
          className="shrink-0 text-muted-foreground"
          date={new Date(closedAt)}
          tooltip={false}
        />
      )}
    </button>
  );
}
