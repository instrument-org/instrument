import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { useOrchestrator } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import { useOnScreen } from "@/client/components/orchestrator/on-screen";
import { RelativeTime } from "@/client/components/relative-time";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

type App = RPCOutput["apps"]["list"]["apps"][number];
type CatalogEntry = RPCOutput["apps"]["catalog"][number];

/**
 * The Apps screen: the directory, in rows. Connected apps first, each with a
 * way to ask about it; the ones half set up, with a way to finish; then what
 * the directory knows, each with a way to connect; and at the end a row for a
 * service nobody listed. Every button is a message to the conversation, since
 * Instrument does the connecting.
 */
export const Route = createFileRoute("/orchestrator/apps/")({
  component: AppsRoute,
});

function AppRow({
  action,
  app,
  line,
  onOpen,
}: {
  action: ReactNode;
  app: App;
  line: ReactNode;
  onOpen: () => void;
}) {
  return (
    <Row
      action={action}
      icon={<AppIcon site={app.site} />}
      line={line}
      onOpen={onOpen}
      title={app.name}
    />
  );
}

function AppsRoute() {
  useOnScreen({ screen: "apps" });
  const { ask } = useOrchestrator();
  const navigate = useNavigate();
  const list = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const catalog = useQuery(rpcClient.apps.catalog.queryOptions());
  const [other, setOther] = useState("");

  const apps = list.data?.apps ?? [];
  const connected = apps.filter((app) => app.standing === "connected");
  const settingUp = apps.filter((app) => app.standing !== "connected");
  const known = new Set(apps.map((app) => app.slug));
  const more = (catalog.data ?? []).filter((entry) => !known.has(entry.slug));
  const openApp = (slug: string) => {
    void navigate({ params: { slug }, to: "/orchestrator/apps/$slug" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto px-8 pt-6 pb-10">
      <h1 className="text-xl font-semibold">Apps</h1>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">
        The services Instrument can reach for you. Connect one and it becomes a
        place here, with a page of its own.
      </p>

      <div className="mt-6 max-w-3xl space-y-8">
        {connected.length > 0 ? (
          <Block label="Connected">
            {connected.map((app) => (
              <AppRow
                action={
                  <GlyphButton
                    onClick={() => {
                      openApp(app.slug);
                    }}
                    size="sm"
                  >
                    Ask
                  </GlyphButton>
                }
                app={app}
                key={app.slug}
                line={connectedLine(app)}
                onOpen={() => {
                  openApp(app.slug);
                }}
              />
            ))}
          </Block>
        ) : null}

        {settingUp.length > 0 ? (
          <Block label="Setting up">
            {settingUp.map((app) => (
              <AppRow
                action={
                  <GlyphButton
                    onClick={() => {
                      ask(`Finish connecting ${app.name}`);
                    }}
                    size="sm"
                  >
                    Continue
                  </GlyphButton>
                }
                app={app}
                key={app.slug}
                line={settingUpLine(app)}
                onOpen={() => {
                  openApp(app.slug);
                }}
              />
            ))}
          </Block>
        ) : null}

        <Block label={connected.length > 0 ? "More" : "Connect one"}>
          {more.map((entry) => (
            <Row
              action={
                <GlyphButton
                  onClick={() => {
                    ask(`Connect ${entry.name}`);
                  }}
                  size="sm"
                >
                  Connect
                </GlyphButton>
              }
              icon={<AppIcon site={`https://${entry.domain}`} />}
              key={entry.slug}
              line={entry.tagline}
              title={entry.name}
            />
          ))}
          <form
            className="flex items-center gap-3 px-3 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              const name = other.trim();
              if (!name) {
                return;
              }
              ask(`Connect ${name}`);
              setOther("");
            }}
          >
            <AppIcon />
            <input
              aria-label="Something else"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-foreground/30"
              onChange={(event) => {
                setOther(event.target.value);
              }}
              placeholder="Something else: a service, an API, a name"
              value={other}
            />
            <GlyphButton disabled={other.trim() === ""} size="sm" type="submit">
              Connect
            </GlyphButton>
          </form>
        </Block>

        {list.data && list.data.invalid.length > 0 ? (
          <Block label="Broken">
            {list.data.invalid.map((entry) => (
              <Row
                action={
                  <GlyphButton
                    onClick={() => {
                      ask(`Fix the ${entry.slug} app; its manifest is broken`);
                    }}
                    size="sm"
                  >
                    Fix
                  </GlyphButton>
                }
                icon={<AppIcon />}
                key={entry.slug}
                line={entry.message}
                title={entry.slug}
              />
            ))}
          </Block>
        ) : null}
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

function connectedLine(app: App): ReactNode {
  const { connection } = app;
  const who = connection?.account ? `as ${connection.account}` : undefined;
  const since = connection?.connectedAt ? (
    <>
      connected <RelativeTime date={new Date(connection.connectedAt)} />
    </>
  ) : (
    "connected"
  );
  return who ? (
    <>
      {who}, {since}
    </>
  ) : (
    since
  );
}

function Row({
  action,
  icon,
  line,
  onOpen,
  title,
}: {
  action: ReactNode;
  icon: ReactNode;
  line: ReactNode;
  onOpen?: () => void;
  title: string;
}) {
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {line}
        </span>
      </span>
    </>
  );
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {onOpen ? (
        <button
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left"
          onClick={onOpen}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-3">{body}</div>
      )}
      {action}
    </div>
  );
}

function settingUpLine(app: App): string {
  switch (app.standing) {
    case "declined": {
      return "Not connected";
    }
    case "failed": {
      return app.connection?.error ?? "Could not connect";
    }
    case "needs-key": {
      return "Needs a key";
    }
    case "needs-sign-in": {
      return "Needs a sign-in";
    }
    case "stale": {
      return "Changed since it was tested";
    }
    default: {
      return "Not tested yet";
    }
  }
}

export type { CatalogEntry };
