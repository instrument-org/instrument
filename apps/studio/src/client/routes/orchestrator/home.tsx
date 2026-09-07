import { pinsAtom, selectedChannelAtom } from "@/client/atoms/orchestrator";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { computerName } from "@/client/components/orchestrator/computer-name";
import {
  ComputerPage,
  type FolderOnScreen,
  RECENTS_ROOT,
} from "@/client/components/orchestrator/computer-page";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { useOpenFileTab } from "@/client/components/orchestrator/file-tabs";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { useQuickLook } from "@/client/components/orchestrator/quick-look";
import { SiteIcon } from "@/client/components/orchestrator/sidebar";
import { ScreenIcon } from "@/client/components/orchestrator/window-tab-strip";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { rpcClient } from "@/client/rpc/client";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import ms from "ms";
import { useState } from "react";

/**
 * A new tab: the apps this workspace reaches, then one box that reaches every
 * screen, every app and any site and, failing those, asks Instrument; under it
 * the places the user kept and the computer in a box. Whatever is picked, this
 * tab becomes it.
 */
export const Route = createFileRoute("/orchestrator/home")({
  component: HomeRoute,
});

/**
 * How many apps and how many bookmarks the page shows before the rest are
 * behind the tile at the end of the row. Both rows are one line and never two:
 * the computer below them should stay in view in a small window, and a row
 * that wraps is the one thing on this page that can grow without being asked.
 */
const APPS_SHOWN = 8;
const PINS_SHOWN = 8;

/** What names a row of things. As small as a label can be and still be read. */
const SECTION_LABEL =
  "mb-1 pl-5.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase";

/**
 * How often the Finder in the box re-reads what it is showing. Slower than the
 * screen's own clock: this page can sit open all day beside the work, and what
 * it shows is a glance rather than a folder being worked in.
 */
const FINDER_REFRESH_MS = ms("30 seconds");

function HomeRoute() {
  const { openPage, openScreen, taskId } = useOrchestrator();
  const navigate = useNavigate();
  const openFileTab = useOpenFileTab();
  const quickLook = useQuickLook({ openFile: openFileTab });
  const selectedChannel = useAtomValue(selectedChannelAtom);
  const pins = useAtomValue(pinsAtom);
  // The folder the Finder in the box has open. Held here rather than in the
  // address, so walking the folders leaves this tab a new tab. It opens on
  // what was touched last, which is what a tab opened to find something is
  // most often opened to find.
  const [finderAt, setFinderAt] = useState({ path: "", root: RECENTS_ROOT });
  // What the box is showing, for the conversation: a new tab with a folder
  // view on it has that folder in view, and what is selected in it.
  const [folder, setFolder] = useState<FolderOnScreen | null>(null);
  useOnScreen({
    ...(folder
      ? {
          folder: {
            ...(folder.access === undefined ? {} : { access: folder.access }),
            display: folder.display,
            ...(folder.mount === undefined ? {} : { mount: folder.mount }),
            selected: folder.selected,
          },
        }
      : {}),
    screen: "home",
  });

  const channels = useQuery(
    rpcClient.workspace.orchestrator.channels.list.queryOptions({
      input: { id: taskId },
    }),
  );
  // Work spans every channel, so the way into it belongs in the one channel
  // that is about the app itself rather than repeated at the foot of every
  // new tab, where it sat beside the user's own things and read as one.
  const isHomeChannel =
    channels.data?.[0]?.id !== undefined &&
    channels.data[0].id === selectedChannel;
  const appList = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const appsBySlug = new Map(
    (appList.data?.apps ?? []).map((app) => [
      app.slug,
      { name: app.name, site: app.site },
    ]),
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden px-8 pt-5 pb-5">
      {/* The services the workspace reaches, under the box: marks with names,
          small enough that the row reads as a strip of faces rather than as
          cards. One line and never two, since a page that grows a row per
          handful of apps pushes the computer under the fold; the rest are
          behind the tile at the end, which is also where a new one is added.
          An app still being connected is drawn faint, since it is not yet a
          way in to anything. */}
      <section className="mx-auto mt-5 w-full max-w-5xl">
        <p className={SECTION_LABEL}>Apps</p>
        <div className="flex flex-nowrap gap-1 overflow-hidden">
          {(appList.data?.apps ?? []).slice(0, APPS_SHOWN).map((app) => (
            <button
              className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 hover:bg-accent/40"
              key={app.slug}
              onClick={() => {
                void navigate({
                  params: { slug: app.slug },
                  to: "/orchestrator/apps/$slug",
                });
              }}
              type="button"
            >
              <AppIcon
                className={
                  app.standing === "connected" ? undefined : "opacity-50"
                }
                site={app.site}
              />
              <span className="line-clamp-2 w-full text-center text-xs leading-tight">
                {app.name}
              </span>
            </button>
          ))}
          <button
            className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 hover:bg-accent/40"
            onClick={() => {
              void navigate({ to: "/orchestrator/apps" });
            }}
            type="button"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground">
              <PlusIcon className="size-4" />
            </span>
            <span className="line-clamp-2 w-full text-center text-xs leading-tight">
              All apps
            </span>
          </button>
        </div>
      </section>

      {/* The places the user kept, which is what a bookmark is: their own
          choice, before anything the app has to offer. Drawn as the apps above
          are, since they are the same gesture and reading as two kinds of
          thing would be the only difference between them. */}
      <section className="mx-auto mt-3 w-full max-w-5xl">
        <p className={SECTION_LABEL}>Bookmarks</p>
        {pins.length === 0 && !isHomeChannel ? (
          <p className="text-xs text-muted-foreground">
            Right-click a tab to pin it here.
          </p>
        ) : (
          <>
            <div className="flex flex-nowrap gap-1 overflow-hidden">
              {/* The app's own room keeps one bookmark it did not have to be
                given: the work, which spans every channel and so belongs to
                the channel that is about the app rather than to a tab. */}
              {isHomeChannel && (
                <button
                  className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 hover:bg-accent/40"
                  onClick={() => {
                    void navigate({ to: "/orchestrator/tasks" });
                  }}
                  type="button"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card shadow-sm">
                    <InstrumentGlyph className="size-5 text-brand-600" />
                  </span>
                  <span className="line-clamp-2 w-full text-center text-xs leading-tight">
                    Tasks
                  </span>
                </button>
              )}
              {pins.slice(0, PINS_SHOWN).map((pin) => (
                <button
                  className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 hover:bg-accent/40"
                  key={pin.id}
                  onClick={() => {
                    if (pin.kind === "page") {
                      openPage(pin.target);
                    } else {
                      openScreen(pin.target);
                    }
                  }}
                  type="button"
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-card shadow-sm [&_img]:size-5 [&_svg]:size-5">
                    {pin.kind === "page" ? (
                      <SiteIcon favicon={pin.favicon} url={pin.target} />
                    ) : (
                      <ScreenIcon appsBySlug={appsBySlug} href={pin.target} />
                    )}
                  </span>
                  <span className="line-clamp-2 w-full text-center text-xs leading-tight">
                    {pin.title}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      {/* The computer itself, in a window on the page: the Finder whole, with
          its places, its columns and its keyboard, opening folders without
          taking the tab anywhere. One size, which is as much of the tab as is
          left: a control that only ever changed its height was answering a
          question the full-width box no longer asks. */}
      <section className="mx-auto mt-5 flex min-h-0 w-full max-w-5xl flex-1 flex-col">
        <p className={SECTION_LABEL}>{computerName()}</p>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-md">
          <ComputerPage
            onFolderChange={(next) => {
              setFolder((current) =>
                JSON.stringify(current) === JSON.stringify(next)
                  ? current
                  : next,
              );
            }}
            onLocationChange={setFinderAt}
            onOpenFile={openFileTab}
            path={finderAt.path}
            refreshInterval={FINDER_REFRESH_MS}
            root={finderAt.root}
            {...quickLook.props}
          />
        </div>
      </section>

      {quickLook.dialog}
    </div>
  );
}
