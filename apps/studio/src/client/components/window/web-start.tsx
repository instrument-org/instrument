import { UNDO_LABEL } from "@/client/lib/undo-toast";
import { openClearBrowsingData } from "@/client/atoms/clear-browsing-data-modal";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import { PageFavicon } from "@/client/components/favicon";
import {
  noteTypedPage,
  useBrowserStartPages,
} from "@/client/hooks/use-browser-history";
import { rpcClient } from "@/client/rpc/client";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { useAtomValue } from "jotai";
import { type ReactNode } from "react";
import { toast } from "@/client/lib/toast";

import { hostOf } from "./bookmark-edits";
import { contentOfAddress, useContentDrag } from "./drag/content-drag";
import { PageContextMenu, usePageClicks } from "./page-menu";
import { PageSection } from "./page-section";
import { VisitedPageRows } from "./visited-page-rows";

/**
 * The web's starting view, laid out as a browser's new tab under the
 * bookmarks bar, which stands over it whether or not the bar is shown
 * elsewhere: the sites visited most as cards, then the pages lately seen as
 * a list, both from the history History's Websites read. A bookmarked site
 * is on the bar, so it is left out of the cards. The tab's own address
 * row, empty and holding the caret, is where an address goes, and anywhere
 * it goes arrives as a tab. Every card and row drags out as its link, to a
 * tab group or anywhere a link goes, and a middle click or a Cmd-click
 * opens it in a tab of its own, waiting behind.
 */
export function WebStart({
  onOpenPage,
}: {
  onOpenPage: (url: string) => void;
}) {
  const bookmarks = useAtomValue(bookmarksStateAtom).bookmarks;
  const { recent, frequent } = useBrowserStartPages(
    bookmarks.map((bookmark) => bookmark.url),
  );
  const clicksFor = usePageClicks();
  // Off the row only: the site's pages stay in history and in Recent pages.
  const setFrequentHidden = (url: string, isHidden: boolean) =>
    rpcClient.history.setFrequentHidden.call({ isHidden, url });
  const hideFrequent = (url: string) => {
    setFrequentHidden(url, true)
      .then(() => {
        toast("Removed from Frequently visited", {
          action: {
            label: UNDO_LABEL,
            onClick: () => {
              void setFrequentHidden(url, false).catch((error: unknown) => {
                toast.error("Couldn't put the site back", { cause: error });
              });
            },
          },
          description: hostOf(url),
        });
      })
      .catch((error: unknown) => {
        toast.error("Couldn't remove the site", { cause: error });
      });
  };
  // A shortcut is an address the person chose, so opening one counts the
  // way typing it would.
  const openShortcut = (url: string) => {
    noteTypedPage(url);
    onOpenPage(url);
  };
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      {/* The Apps place's column, so moving between the two places never
          moves the edges the page is read against. */}
      <div className="mx-auto w-full max-w-5xl space-y-10 px-10 pt-20 pb-14">
        {frequent.length === 0 && recent.length === 0 && (
          <div className="flex flex-col items-center gap-1 pt-10 text-center">
            <p className="text-sm font-medium">No websites yet</p>
            <p className="text-[13px] text-muted-foreground">
              Websites you visit show up here.
            </p>
          </div>
        )}
        {frequent.length > 0 && (
          <PageSection title="Frequently visited">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-3">
              {frequent.map((page) => (
                <PageContextMenu
                  key={page.url}
                  onOpen={openShortcut}
                  onRemove={() => {
                    hideFrequent(page.url);
                  }}
                  removeLabel="Remove from Frequently visited"
                  url={page.url}
                >
                  <LinkDrag title={page.title} url={page.url}>
                    {(dragProps) => (
                  <button
                    className="group flex min-w-0 flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left hover:bg-accent/50 data-[state=open]:bg-accent/50"
                    {...clicksFor(page.url, openShortcut)}
                    {...dragProps}
                    title={`${page.title || hostOf(page.url)}\n${page.url}`}
                    type="button"
                  >
                    <PageFavicon
                      className="size-7"
                      favicon={page.favicon}
                      hasTooltip={false}
                      url={page.url}
                    />
                    <span className="w-full min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {hostOf(page.url)}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {page.title || hostOf(page.url)}
                      </span>
                    </span>
                  </button>
                    )}
                  </LinkDrag>
                </PageContextMenu>
              ))}
            </div>
          </PageSection>
        )}
        {recent.length > 0 && (
          <PageSection
            action={{
              icon: <BroomIcon className="size-3.5" />,
              label: "Clear Browsing Data",
              onPress: openClearBrowsingData,
            }}
            title="Recent pages"
          >
            <VisitedPageRows
              hasHost
              isCompact
              onOpen={onOpenPage}
              visits={recent.map((page) => ({ page }))}
            />
          </PageSection>
        )}
      </div>
    </div>
  );
}

/** A mark or a card, given the props that drag it out as its page's link (`useContentDrag`). */
function LinkDrag({
  children,
  title,
  url,
}: {
  children: (dragProps: ReturnType<typeof useContentDrag>) => ReactNode;
  title: string;
  url: string;
}) {
  return children(useContentDrag(contentOfAddress(url, title)));
}
