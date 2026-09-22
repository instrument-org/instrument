import { visitedPagesAtom } from "@/client/atoms/orchestrator";
import { blockToolbarButtonClassName } from "@/client/components/code-block";
import { CopyButton } from "@/client/components/copy-button";
import { InternalLink } from "@/client/components/internal-link";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { visitsWithin } from "@/client/components/orchestrator/app-visits";
import { ConnectControls } from "@/client/components/orchestrator/connect-controls";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { VisitedPageRows } from "@/client/components/orchestrator/visited-page-rows";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { DotsThreeIcon } from "@phosphor-icons/react/DotsThree";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAtomValue } from "jotai";
import { toast } from "sonner";

/** How many of the pages visited in the app its front lists. */
const VISITS_SHOWN = 8;

/**
 * An app's page, which is its front: where you have been in it lately, out
 * of the window's own browsing held to the app's site, with the app itself
 * one labeled button away. Before it is connected, a listing: what the
 * directory says it is and what connecting takes, with the one control that
 * finishes that. Connected, it is a connection too: the way to ask about
 * it, whose it is and since when, what it can do, and a menu by its name
 * for taking it away.
 */
export const Route = createFileRoute("/orchestrator/apps/$slug")({
  component: AppRoute,
});

function AppRoute() {
  const { slug } = Route.useParams();
  const { ask, browser, openPage } = useOrchestrator();
  const navigate = useNavigate();
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  const app = list.data?.apps.find((entry) => entry.slug === slug);
  const entry = catalog.data?.find((candidate) => candidate.slug === slug);
  const name = app?.name ?? entry?.name ?? slug;
  const site = app?.site ?? (entry ? `https://${entry.domain}` : undefined);
  const home = app?.home ?? entry?.home ?? site;
  const isConnected = app?.standing === "connected";
  useOnScreen({
    app: {
      name,
      slug,
      standing: app?.standing ?? "not-set-up",
    },
    screen: "apps",
  });
  // The pages the window has shown on the app's site, newest first: the
  // best place to start in an app is where you already were in it.
  const visited = useAtomValue(visitedPagesAtom);
  const visits = visitsWithin(visited, [{ name, site }]).slice(0, VISITS_SHOWN);

  const disconnect = useMutation(
    rpcClient.apps.disconnect.mutationOptions({
      onError: (error) => {
        toast.error("Could not disconnect", { description: error.message });
      },
    }),
  );
  const remove = useMutation(
    rpcClient.apps.remove.mutationOptions({
      onError: (error) => {
        toast.error("Could not remove the app", {
          description: error.message,
        });
      },
      onSuccess: () => {
        void navigate({ to: "/orchestrator/apps" });
      },
    }),
  );
  const test = useMutation(
    rpcClient.apps.test.mutationOptions({
      onError: (error) => {
        toast.error("Could not test the app", { description: error.message });
      },
      onSuccess: (report) => {
        if (!report.passed) {
          const failure = report.checks.find(
            (check) => check.status === "fail",
          );
          toast.error(`${name} did not connect`, {
            description: failure?.detail.split("\n")[0],
          });
        }
      },
    }),
  );

  if (list.isPending || catalog.isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!app && !entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>No app called “{slug}”.</p>
        <InternalLink className="underline" to="/orchestrator/apps">
          Apps
        </InternalLink>
      </div>
    );
  }

  const domain = home ? new URL(home).host : undefined;
  const description = entry?.description ?? entry?.tagline;
  const needs = app
    ? app.type === "mcp-local"
      ? `Its server runs on this Mac: Instrument installs and starts ${app.runs ?? app.endpoint}${app.authKind === "env" ? `, with a key from ${name} in its environment` : ""}.`
      : app.type === "mcp" && app.authKind === "oauth"
        ? `A sign-in with ${name}, once.`
        : app.authKind === "none"
          ? "Nothing: it is open."
          : `A key from ${name}, which Instrument stores encrypted on this Mac.`
    : (entry?.authMethods ?? []).map((method) => method.label).join(", ");
  const openHome = () => {
    if (home && browser) {
      openPage(home);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-7 pb-10">
      <div className="mx-auto w-full max-w-3xl">
        {/* No way back up to Apps here: the row above says where this is. */}
        <div className="flex items-center gap-4">
          <AppIcon name={name} site={site} size="xl" />
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <h1 className="text-[22px] leading-7 font-semibold">{name}</h1>
              {app ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={`More for ${name}`}
                      className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
                      type="button"
                    >
                      <DotsThreeIcon className="size-4" weight="bold" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      disabled={test.isPending}
                      onSelect={() => {
                        test.mutate({ slug });
                      }}
                    >
                      Test the connection
                    </DropdownMenuItem>
                    {isConnected || app.hasCredential ? (
                      <DropdownMenuItem
                        disabled={disconnect.isPending}
                        onSelect={() => {
                          disconnect.mutate({ slug });
                        }}
                      >
                        Disconnect
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      disabled={remove.isPending}
                      onSelect={() => {
                        remove.mutate({ slug });
                      }}
                      variant="destructive"
                    >
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {domain ?? (app ? app.endpoint : "")}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {/* The site is a site whether or not the app is connected, so the
              way to it is always here, wearing the app's own mark;
              connecting is what the agent needs, not what a person needs to
              open a page. */}
            {home && browser ? (
              <button
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground shadow-xs hover:bg-accent"
                onClick={openHome}
                type="button"
              >
                <AppIcon name={name} site={site} size="sm" />
                <span className="truncate">Open {name}</span>
              </button>
            ) : null}
            {isConnected ? (
              <GlyphButton
                onClick={() => {
                  ask(`What can you do with ${name} for me?`);
                }}
                size="sm"
              >
                Ask about {name}
              </GlyphButton>
            ) : null}
          </div>
        </div>

        {/* The directory's line about the app, quiet under the head, until
          the person has been somewhere in it: a page with rows explains
          itself. */}
        {description && visits.length === 0 ? (
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}

        {/* Where you were in the app, first and always: a recent page is a
          row you press, not a name you have to type back into the field,
          and the best way back into a service is the page you were on. */}
        <section className="mt-8">
          <p className="mb-2.5 text-[13px] font-medium text-muted-foreground">
            Recently visited
          </p>
          {visits.length > 0 ? (
            <VisitedPageRows onOpen={openPage} visits={visits} />
          ) : (
            <p className="text-[13px] text-muted-foreground">
              The pages you open in {name} will show up here.
            </p>
          )}
        </section>

        {/* While the app is still being set up, the one thing that
          finishes it, in a quiet block: what connecting takes, the control
          for it, and what went wrong the last time, kept whole for copying.
          Gone the moment the connection lands; nothing about a connection
          stands on a connected app's front. */}
        {isConnected ? null : (
          <section className="mt-8">
            <p className="mb-2.5 text-[13px] font-medium text-muted-foreground">
              Setting up
            </p>
            <div className="rounded-xl border border-border bg-card p-4">
              {needs ? (
                <p className="mb-3 text-sm text-muted-foreground">{needs}</p>
              ) : null}
              {app?.standing === "needs-sign-in" ? (
                <ConnectControls kind="sign-in" name={name} slug={slug} />
              ) : app?.standing === "needs-approval" ? (
                <ConnectControls
                  kind="run"
                  name={name}
                  runs={app.runs}
                  slug={slug}
                />
              ) : app?.standing === "needs-key" ? (
                <ConnectControls kind="key" name={name} slug={slug} />
              ) : (
                <GlyphButton
                  onClick={() => {
                    ask(
                      app && app.standing !== "untested"
                        ? `Finish connecting ${name}`
                        : `Connect ${name}`,
                    );
                  }}
                  size="sm"
                >
                  Connect {name}
                </GlyphButton>
              )}
              {app?.standing === "failed" && app.connection?.error ? (
                <div className="group/detail relative mt-3 rounded-lg bg-muted/60 px-3 py-2">
                  <pre className="max-h-32 scrollbar-thin scrollbar-color overflow-auto pr-7 font-mono text-xs leading-5 wrap-break-word whitespace-pre-wrap text-foreground/80">
                    {app.connection.error}
                  </pre>
                  {/* `focus-within` as well as hover: the button stays in the
                      tab order while it is transparent. */}
                  <div className="absolute top-2 right-2 opacity-0 group-hover/detail:opacity-100 focus-within:opacity-100">
                    <CopyButton
                      className={blockToolbarButtonClassName}
                      iconSize={12}
                      onCopy={async () => {
                        await navigator.clipboard.writeText(
                          app.connection?.error ?? "",
                        );
                      }}
                      tooltip="Copy"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
