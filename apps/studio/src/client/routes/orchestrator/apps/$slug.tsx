import { InternalLink } from "@/client/components/internal-link";
import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { ConnectControls } from "@/client/components/orchestrator/connect-controls";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { RelativeTime } from "@/client/components/relative-time";
import { Button } from "@/client/components/ui/button";
import { Spinner } from "@/client/components/ui/spinner";
import { rpcClient } from "@/client/rpc/client";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { toast } from "sonner";

/**
 * An app's page. Before it is connected, a listing: what the directory says
 * it is and what connecting takes, with the one button that starts that.
 * Connected, it is a connection: whose, since when, what it can do, and the
 * way to ask about it or take it away.
 */
export const Route = createFileRoute("/orchestrator/apps/$slug")({
  component: AppRoute,
});

function AppRoute() {
  const { slug } = Route.useParams();
  const { ask, browser } = useOrchestrator();
  const navigate = useNavigate();
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  const app = list.data?.apps.find((entry) => entry.slug === slug);
  const entry = catalog.data?.find((candidate) => candidate.slug === slug);
  const name = app?.name ?? entry?.name ?? slug;
  const site = app?.site ?? (entry ? `https://${entry.domain}` : undefined);
  const isConnected = app?.standing === "connected";
  useOnScreen({
    app: {
      name,
      slug,
      standing: app?.standing ?? "not-set-up",
    },
    screen: "apps",
  });

  const tools = useQuery(
    rpcClient.apps.tools.queryOptions({
      input: isConnected && app.type === "mcp" ? { slug } : skipToken,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
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

  const domain = site ? new URL(site).host : undefined;
  const description = entry?.description ?? entry?.tagline;
  const canDo: string[] =
    isConnected && app.type === "mcp"
      ? (tools.data ?? []).map((tool) => tool.name)
      : (entry?.interfaces ?? []).map((surface) =>
          surface.endpoint
            ? `${surface.name} (${surface.format})`
            : surface.name,
        );
  const needs = app
    ? app.type === "mcp" && app.authKind === "oauth"
      ? `A sign-in with ${name}, once.`
      : app.authKind === "none"
        ? "Nothing: it is open."
        : `A key from ${name}, which Instrument stores encrypted on this Mac.`
    : (entry?.authMethods ?? []).map((method) => method.label).join(", ");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-6 pb-10">
      <InternalLink
        className="text-xs text-muted-foreground hover:text-foreground"
        to="/orchestrator/apps"
      >
        Apps
      </InternalLink>
      <div className="mt-2 flex items-center gap-4">
        <AppIcon site={site} size="lg" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{name}</h1>
          <p className="text-xs text-muted-foreground">
            {domain ?? (app ? app.endpoint : "")}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isConnected ? (
            <GlyphButton
              onClick={() => {
                ask(`What can you do with ${name} for me?`);
              }}
            >
              Ask about {name}
            </GlyphButton>
          ) : app?.standing === "needs-sign-in" ? (
            <ConnectControls kind="sign-in" name={name} slug={slug} />
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
            >
              Connect {name}
            </GlyphButton>
          )}
        </div>
      </div>
      {description ? (
        <p className="mt-4 max-w-2xl text-sm leading-6">{description}</p>
      ) : null}

      <div className="mt-6 grid max-w-3xl gap-6">
        {app?.connection && app.standing !== "untested" ? (
          <Block label="Status">
            <Line>
              {app.standing === "connected"
                ? `Connected${app.connection.account ? ` as ${app.connection.account}` : ""}`
                : app.standing === "stale"
                  ? "Connected, then changed; Instrument will test it again"
                  : app.standing === "needs-sign-in"
                    ? "Waiting for a sign-in"
                    : app.standing === "needs-key"
                      ? "Waiting for a key"
                      : app.standing === "declined"
                        ? "Not connected"
                        : `Could not connect${app.connection.error ? `: ${app.connection.error}` : ""}`}
              {app.connection.connectedAt ? (
                <>
                  {" "}
                  · since{" "}
                  <RelativeTime date={new Date(app.connection.connectedAt)} />
                </>
              ) : null}
            </Line>
          </Block>
        ) : null}

        {canDo.length > 0 ? (
          <Block label={isConnected ? "What it can do" : "How it is reached"}>
            {canDo.map((item) => (
              <Line key={item}>{item}</Line>
            ))}
          </Block>
        ) : null}

        {needs ? (
          <Block label="Needs">
            <Line>{needs}</Line>
          </Block>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 px-1">
          {site && browser ? (
            <Button
              onClick={() => {
                browser.openOrFocus(site);
                void navigate({ to: "/orchestrator/browser" });
              }}
              size="sm"
              variant="outline"
            >
              Open {domain}
            </Button>
          ) : null}
          {app && (isConnected || app.hasCredential) ? (
            <Button
              disabled={disconnect.isPending}
              onClick={() => {
                disconnect.mutate({ slug });
              }}
              size="sm"
              variant="ghost"
            >
              Disconnect
            </Button>
          ) : null}
          {app ? (
            <Button
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate({ slug });
              }}
              size="sm"
              variant="ghost"
            >
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Block({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section>
      <p className="px-3 text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </p>
      <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

function Line({ children }: { children: ReactNode }) {
  return <p className="px-3 py-2 text-sm">{children}</p>;
}
