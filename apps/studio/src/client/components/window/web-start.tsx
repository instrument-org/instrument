import { applyBookmarkOpsAtom, bookmarksAtom } from "@/client/bookmarks/store";
import { type Bookmark } from "@/shared/bookmarks";
import { PageFavicon } from "@/client/components/favicon";
import {
  noteTypedPage,
  useBrowserStartPages,
} from "@/client/hooks/use-browser-history";
import { rpcClient } from "@/client/rpc/client";
import { BroomIcon } from "@phosphor-icons/react/Broom";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react/DotsThreeVertical";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useAtomValue, useSetAtom } from "jotai";
import { useState } from "react";
import { toast } from "@/client/lib/toast";

import { AppIcon } from "./app-icon";
import { PageContextMenu, usePageClicks } from "./page-menu";
import { PageSection } from "./page-section";
import { VisitedPageRows } from "./visited-page-rows";

/**
 * The web's starting view, laid out as a browser's new tab: the sites kept
 * as large marks with their names under them, the way apps are, and the
 * pages lately seen under those as a list. The tab's own address row, over
 * it wherever it is drawn, is where an address goes. Anywhere it goes
 * arrives as a tab. A page is bookmarked from its own menu; a right click on
 * its mark here offers to rename it or remove it, and a middle click or a
 * Cmd-click opens it in a tab of its own, waiting behind.
 */
export function WebStart({
  onOpenPage,
}: {
  onOpenPage: (url: string) => void;
}) {
  const bookmarks = useAtomValue(bookmarksAtom);
  const applyBookmarkOps = useSetAtom(applyBookmarkOpsAtom);
  const { recent, frequent } = useBrowserStartPages(
    bookmarks.map((bookmark) => bookmark.url),
  );
  const clicksFor = usePageClicks();
  // The bookmark whose name is being typed over, by id.
  const [renamingId, setRenamingId] = useState<string>();
  const rename = (bookmark: Bookmark, title: string) => {
    setRenamingId(undefined);
    const named = title.trim();
    if (named === bookmark.title || !named) {
      return;
    }
    void applyBookmarkOps([{ id: bookmark.id, title: named, type: "rename" }]);
  };
  const remove = (bookmark: Bookmark) => {
    void applyBookmarkOps([{ id: bookmark.id, type: "remove" }]);
    toast("Removed from Bookmarks", {
      action: {
        label: "Undo",
        // Back where it was, by the order it had.
        onClick: () => {
          void applyBookmarkOps([{ bookmark, type: "add" }]);
        },
      },
      description: bookmark.title || hostOf(bookmark.url),
    });
  };
  // Off the row only: the site's pages stay in history and in Recent pages.
  const setFrequentHidden = (url: string, isHidden: boolean) =>
    rpcClient.history.setFrequentHidden.call({ isHidden, url });
  const hideFrequent = (url: string) => {
    setFrequentHidden(url, true)
      .then(() => {
        toast("Removed from Frequently visited", {
          action: {
            label: "Undo",
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
  // Every page the person has seen, not only the dozen shown, since what
  // the rest feed is the address field's completions, and a person clearing
  // their recent pages means those too.
  const clearRecent = () => {
    void rpcClient.history.clear
      .call({})
      .then(() => {
        toast("Removed all Recent Pages");
      })
      .catch((error: unknown) => {
        toast.error("Couldn't clear Recent Pages", { cause: error });
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
        <PageSection title="Bookmarks">
          {bookmarks.length === 0 ? (
            <NoBookmarks />
          ) : (
            // Pulled in by the gap between a mark's box and its icon, so the
            // icons line up under the heading.
            <div className="-ml-4 flex flex-wrap gap-x-2 gap-y-3">
              {bookmarks.map((bookmark) => {
                const name = bookmark.title || hostOf(bookmark.url);
                // The site's mark drawn the way Apps draws every app's.
                const mark = (
                  <AppIcon
                    name={name}
                    site={originOf(bookmark.url)}
                    size="xl"
                  />
                );
                if (bookmark.id === renamingId) {
                  return (
                    <div
                      className="flex w-24 flex-col items-center gap-2 py-2"
                      key={bookmark.id}
                    >
                      {mark}
                      <BookmarkNameField
                        name={name}
                        onCancel={() => {
                          setRenamingId(undefined);
                        }}
                        onCommit={(title) => {
                          rename(bookmark, title);
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <PageContextMenu
                    key={bookmark.id}
                    onOpen={openShortcut}
                    onRemove={() => {
                      remove(bookmark);
                    }}
                    onRename={() => {
                      setRenamingId(bookmark.id);
                    }}
                    removeLabel="Remove from Bookmarks"
                    url={bookmark.url}
                  >
                    <button
                      className="group flex w-24 flex-col items-center gap-2 rounded-xl py-2 text-center hover:bg-accent/50 data-[state=open]:bg-accent/50"
                      {...clicksFor(bookmark.url, openShortcut)}
                      title={`${name}\n${bookmark.url}`}
                      type="button"
                    >
                      {mark}
                      {/* As wide as the mark's box, on two lines at most, the
                        way a browser's favorites name theirs. */}
                      <span className="line-clamp-2 w-full px-1.5 text-[13px] leading-4 font-medium break-words">
                        {name}
                      </span>
                    </button>
                  </PageContextMenu>
                );
              })}
            </div>
          )}
        </PageSection>
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
                  <button
                    className="group flex min-w-0 flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left hover:bg-accent/50 data-[state=open]:bg-accent/50"
                    {...clicksFor(page.url, openShortcut)}
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
                </PageContextMenu>
              ))}
            </div>
          </PageSection>
        )}
        {recent.length > 0 && (
          <PageSection
            action={{
              icon: <BroomIcon className="size-3.5" />,
              label: "Remove all",
              onPress: clearRecent,
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

/**
 * Where the bookmarks will be, before there are any: a quiet panel the
 * width of the column, and in it a bookmark drawn the way the shelf draws
 * one, a plate with the brand's ribbon on it and two more tucked behind,
 * over what the shelf is for and the way a page gets onto it, in the words
 * and the mark of the page menu that does it.
 */
function NoBookmarks() {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-black/2 px-6 pt-10 pb-11 dark:bg-white/3">
      <div
        aria-hidden
        className="relative mb-5 grid size-16 scale-90 place-items-center"
      >
        {/* The two behind: a size down, fanned out from under the front
            one so only their outer corners show. They arrive tucked in a
            little closer and open out once, slowly, as the page appears.
            Opaque fills and inset rings keep each edge on its own card;
            soft shadows leave out elevation's translucent outer ring. */}
        <span className="absolute size-13 -translate-x-4.5 -rotate-12 rounded-xl bg-card shadow-xs-soft inset-ring inset-ring-border/70 transition-[translate,rotate] delay-100 duration-700 ease-out motion-reduce:transition-none starting:-translate-x-2 starting:-rotate-4" />
        <span className="absolute size-13 translate-x-4.5 rotate-12 rounded-xl bg-card shadow-xs-soft inset-ring inset-ring-border/70 transition-[translate,rotate] delay-100 duration-700 ease-out motion-reduce:transition-none starting:translate-x-2 starting:rotate-4" />
        <span className="relative grid size-16 place-items-center overflow-hidden rounded-2xl bg-card shadow-md-soft inset-ring inset-ring-border">
          <GlobeIcon
            className="size-7 text-muted-foreground/45"
            weight="light"
          />
          {/* A ribbon hung from the plate's top edge, drawn rather than
              taken from the icon set, whose bookmark stands a little below
              the top of its box. */}
          <svg
            className="absolute top-0 right-3 h-4.5 w-3.5 fill-brand-300"
            viewBox="0 0 14 18"
          >
            <path d="M0 0h14v18l-7-4.5L0 18z" />
          </svg>
        </span>
      </div>
      <p className="text-sm font-medium text-foreground/80">No bookmarks yet</p>
      <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-1 text-center text-[13px] leading-6 text-muted-foreground">
        Choose
        <span className="font-medium text-foreground/70">Add to bookmarks</span>
        from the
        <span className="mx-1 inline-grid size-5 place-items-center rounded-md bg-card shadow-xs ring-1 ring-border">
          <DotsThreeVerticalIcon
            aria-label="page"
            className="size-3.5 text-foreground/70"
            weight="bold"
          />
        </span>
        menu on a website to add bookmarks
      </p>
    </div>
  );
}

/**
 * A bookmark's name being typed over, where its name was: all of it selected
 * to begin with, Return or a press elsewhere keeping what was typed, Escape
 * putting the old name back.
 */
function BookmarkNameField({
  name,
  onCancel,
  onCommit,
}: {
  name: string;
  onCancel: () => void;
  onCommit: (name: string) => void;
}) {
  const [value, setValue] = useState(name);
  return (
    <input
      aria-label="Bookmark name"
      autoFocus
      className="w-full rounded-sm border border-ring bg-background px-1 text-center text-[13px] leading-4 font-medium outline-none"
      onBlur={() => {
        onCommit(value);
      }}
      onChange={(event) => {
        setValue(event.target.value);
      }}
      onFocus={(event) => {
        event.currentTarget.select();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      value={value}
    />
  );
}

/** The site a page is on, as its bar would name it. */
function hostOf(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  return new URL(url).hostname.replace(/^www\./, "") || url;
}

function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : url;
}
