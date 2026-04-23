import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronRightIcon, MonitorIcon } from "lucide-react";

type Entry = Snapshot["entries"][number];
type ProjectBrowser = Snapshot["projectBrowsers"][number];
type Snapshot = RPCOutput["debug"]["browserViewManager"]["snapshot"];
type Tone = "danger" | "muted" | "ok" | "warn";

const toneClass: Record<Tone, string> = {
  danger: "bg-red-500/15 text-red-700 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
  ok: "bg-green-500/15 text-green-700 dark:text-green-400",
  warn: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
};

export const Route = createFileRoute("/_app/debug/browser-view-manager")({
  component: RouteComponent,
});

function EntryCard({ entry }: { entry: Entry }) {
  const status: { label: string; tone: Tone } = entry.webContentsDestroyed
    ? { label: "page gone", tone: "danger" }
    : entry.isCrashed
      ? { label: "crashed", tone: "danger" }
      : entry.isLoading
        ? { label: "loading", tone: "warn" }
        : { label: "ready", tone: "ok" };

  const openAsTab = useMutation(
    rpcClient.debug.browserViewManager.openAsTab.mutationOptions(),
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-2 space-y-0 pb-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <CardTitle className="truncate text-sm">
              {entry.title || entry.url || "(blank page)"}
            </CardTitle>
            <p className="truncate font-mono text-[11px] text-muted-foreground">
              {entry.subdomain} · {entry.sessionId}
            </p>
          </div>
          <Button
            disabled={entry.webContentsDestroyed || openAsTab.isPending}
            onClick={() => {
              openAsTab.mutate({ targetId: entry.targetId });
            }}
            size="sm"
            variant="outline"
          >
            <MonitorIcon className="size-3.5" />
            View
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          <StatusBadge label={status.label} tone={status.tone} />
          {entry.debuggerAttached ? (
            <StatusBadge label="cdp attached" tone="ok" />
          ) : (
            <StatusBadge label="no cdp" tone="muted" />
          )}
          {entry.audioMuted && <StatusBadge label="muted" tone="muted" />}
          {entry.screencastActive && (
            <StatusBadge label="screencast" tone="ok" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <Field label="URL">
          <Mono>{entry.url || "(empty)"}</Mono>
        </Field>

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
            Internals
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            <Field label="Target id">
              <Mono>{entry.targetId}</Mono>
            </Field>
            <Field label="Profile dir">
              <Mono>{entry.partitionDir}</Mono>
            </Field>
            <Field label="webContents">
              <span className="font-mono">
                id={entry.webContentsId ?? "n/a"}
              </span>
            </Field>
            <Field label="Listeners">
              <span className="font-mono">
                event {entry.eventListenerCount} / detach{" "}
                {entry.detachListenerCount} / destruction{" "}
                {entry.destructionListenerCount} / disposers{" "}
                {entry.disposerCount}
              </span>
            </Field>
            <Field label="Screencast">
              <span className="font-mono">
                {entry.screencastActive ? "active" : "idle"} (session{" "}
                {entry.screencastSessionId})
              </span>
            </Field>
            <Field label="Downloads">
              <span className="font-mono">
                pending {entry.pendingDownloadCount}
                {entry.authorizedDownloadPath
                  ? ` · authorized: ${entry.authorizedDownloadPath}`
                  : ""}
              </span>
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 text-xs">{children}</div>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="block w-full overflow-x-auto rounded-sm bg-muted/40 px-2 py-1 font-mono text-[11px] whitespace-nowrap">
      {children}
    </code>
  );
}

function ProjectBrowserCard({
  projectBrowser,
}: {
  projectBrowser: ProjectBrowser;
}) {
  const status = projectBrowserStatus(projectBrowser.state);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="gap-2 space-y-0 pb-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1 space-y-0.5">
            <CardTitle className="truncate text-sm">
              {projectBrowser.subdomain}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{status.help}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <StatusBadge label={status.label} tone={status.tone} />
          {projectBrowser.pendingReapResolverCount > 0 && (
            <StatusBadge
              label={`${projectBrowser.pendingReapResolverCount} waiting`}
              tone="warn"
            />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <Field label="Open pages">
          {projectBrowser.knownTargets.length === 0 ? (
            <span className="text-muted-foreground">none</span>
          ) : (
            <div className="space-y-1">
              {projectBrowser.knownTargets.map(
                (t: ProjectBrowser["knownTargets"][number]) => (
                  <Mono key={t.sessionId}>
                    <span className="text-muted-foreground">{t.sessionId}</span>
                    {t.targetId ? ` → ${t.targetId}` : " (not yet attached)"}
                  </Mono>
                ),
              )}
            </div>
          )}
        </Field>
        {projectBrowser.destroyedExternallyTargetIds.length > 0 && (
          <Field label="Closed elsewhere">
            <Mono>{projectBrowser.destroyedExternallyTargetIds.join(" ")}</Mono>
          </Field>
        )}

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
            Internals
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            <Field label="Machine state">
              <Mono>{projectBrowser.state}</Mono>
            </Field>
            <Field label="Profile dir">
              <Mono>{projectBrowser.partitionDir ?? "(none)"}</Mono>
            </Field>
            <Field label="Watched">
              {projectBrowser.watchedTargetIds.length === 0 ? (
                <span className="text-muted-foreground">none</span>
              ) : (
                <Mono>{projectBrowser.watchedTargetIds.join(" ")}</Mono>
              )}
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function projectBrowserStatus(state: string): {
  help: string;
  label: string;
  tone: Tone;
} {
  if (state.includes("Stopping")) {
    return {
      help: "Idle long enough to be cleaned up. Pages are being torn down.",
      label: "shutting down",
      tone: "warn",
    };
  }
  if (state.includes("Stopped")) {
    return {
      help: "All browsers for this project have been reaped.",
      label: "stopped",
      tone: "danger",
    };
  }
  if (state.includes("Active")) {
    return {
      help: "Agent or user is actively using a browser in this project.",
      label: "running",
      tone: "ok",
    };
  }
  return { help: state, label: state, tone: "muted" };
}

function RouteComponent() {
  const { data } = useQuery(
    rpcClient.debug.browserViewManager.live.snapshot.experimental_liveOptions(),
  );

  const captured = data?.capturedAt
    ? new Date(data.capturedAt).toLocaleTimeString()
    : "...";

  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base font-semibold">Agent Browsers</h1>
            <p className="text-xs text-muted-foreground">
              Live view of every agent-controlled browser plus the per-project
              machines that decide when to clean them up.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>updated {captured}</span>
            <span>·</span>
            <span>dev mode {data?.developerMode ? "on" : "off"}</span>
          </div>
        </header>

        <section className="flex flex-col gap-2">
          <SectionHeader
            count={data?.entries.length}
            help="Each card is one WebContentsView the main process is hosting."
            title="Browsers"
          />
          {data && data.entries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No agent browsers are open right now.
            </p>
          ) : (
            data?.entries.map((entry) => (
              <EntryCard entry={entry} key={entry.targetId} />
            ))
          )}
        </section>

        <section className="flex flex-col gap-2">
          <SectionHeader
            count={data?.projectBrowsers.length}
            help="One per project. Tracks which sessions are watching, and reaps idle browsers after the cleanup delay."
            title="Cleanup machines"
          />
          {data && data.projectBrowsers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No projects have spawned a browser machine yet.
            </p>
          ) : (
            data?.projectBrowsers.map((pb) => (
              <ProjectBrowserCard key={pb.subdomain} projectBrowser={pb} />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({
  count,
  help,
  title,
}: {
  count: number | undefined;
  help: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground">{count ?? "..."}</span>
      </div>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  return (
    <Badge className={toneClass[tone]} variant="secondary">
      {label}
    </Badge>
  );
}
