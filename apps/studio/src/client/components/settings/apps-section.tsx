import { APPS_HREF } from "@/client/atoms/window";
import { Button } from "@/client/components/ui/button";
import { Card } from "@/client/components/ui/card";
import { Skeleton } from "@/client/components/ui/skeleton";
import { AppIcon } from "@/client/components/window/app-icon";
import { AppContextMenu } from "@/client/components/window/app-menu";
import { waitingLine } from "@/client/components/window/apps-home";
import { useOpenGestures } from "@/client/hooks/use-open-target";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { useQuery } from "@tanstack/react-query";

type App = RPCOutput["apps"]["list"]["apps"][number];

/**
 * Settings › Apps: the apps this workspace has, each opening its own page,
 * and the way to the Apps page, where a new one is found and connected, as
 * a browser's settings open its extensions.
 */
export function AppsSection() {
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const directory = useOpenGestures(
    { href: APPS_HREF, kind: "screen" },
    { isLink: true },
  );
  const apps = list.data?.apps ?? [];
  // Connected first, then the ones still being set up, as the Apps page
  // lists them.
  const own = [
    ...apps.filter((app) => app.status === "connected"),
    ...apps.filter((app) => app.status !== "connected"),
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Apps</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your existing services to work with them in Instrument.
          </p>
        </div>
        <Button
          onAuxClick={directory.onAuxClick}
          onClick={directory.onClick}
          onContextMenu={directory.onContextMenu}
          size="sm"
          variant="outline"
        >
          <PlusIcon />
          Add an app
        </Button>
      </div>
      {list.data === undefined ? (
        <Card className="gap-0 divide-y divide-border p-0">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="flex items-center gap-3 p-4" key={index}>
              <Skeleton className="size-8 rounded-lg" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </Card>
      ) : own.length === 0 ? (
        <Card className="items-center gap-3 px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            You haven’t connected any apps yet. Once you do, you can use them
            from any chat.
          </p>
        </Card>
      ) : (
        <Card className="gap-0 divide-y divide-border p-0">
          {own.map((app) => (
            <AppRow app={app} key={app.slug} />
          ))}
        </Card>
      )}
    </div>
  );
}

/** One of the workspace's apps: its icon, its name, which account or what it waits for, opening its page. */
function AppRow({ app }: { app: App }) {
  const page = useOpenGestures(
    { href: `${APPS_HREF}/${app.slug}`, kind: "screen" },
    { isLink: true },
  );
  const line = app.status === "connected" ? app.account : waitingLine(app);
  return (
    <AppContextMenu app={app} name={app.name} opens={page.destinations}>
      <button
        className="flex w-full items-center gap-3 p-4 text-left first:rounded-t-xl last:rounded-b-xl hover:bg-accent/50"
        onAuxClick={page.onAuxClick}
        onClick={page.onClick}
        type="button"
      >
        <AppIcon icon={app.icon} name={app.name} site={app.site} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{app.name}</span>
          {line ? (
            <span className="block truncate text-xs text-muted-foreground">
              {line}
            </span>
          ) : null}
        </span>
        <CaretRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </AppContextMenu>
  );
}
