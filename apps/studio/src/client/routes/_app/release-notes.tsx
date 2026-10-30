import { displayLocale } from "@/client/lib/display-locale";
import { ExternalLink } from "@/client/components/external-link";
import { Markdown } from "@/client/components/markdown";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { useRestartToUpdate } from "@/client/components/update-status-indicator";
import { showsAsRestarting } from "@/client/components/use-install-update";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  detailOf,
  planPage,
  type Release,
  versionLabel,
} from "@/client/lib/release-notes";
import { RELEASE_NOTES_URL } from "@instrument-org/shared";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/ArrowSquareOut";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { WifiSlashIcon } from "@phosphor-icons/react/WifiSlash";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

export const Route = createFileRoute("/_app/release-notes")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Release notes" }],
  }),
  staticData: { tabIcon: "file-text" },
  validateSearch: z.object({
    /** The version an update left, whose successors the page opens on. */
    since: z.string().optional(),
  }),
});

function RouteComponent() {
  const { since } = Route.useSearch();
  const releasesQuery = useQuery(rpcClient.releases.list.queryOptions());
  const { data: appVersion } = useQuery(
    rpcClient.preferences.getAppVersion.queryOptions(),
  );
  const { data: updateState } = useQuery(
    rpcClient.updates.live.status.experimental_liveOptions(),
  );
  const staged =
    updateState?.type === "downloaded"
      ? updateState.updateInfo?.version
      : undefined;
  const releases = releasesQuery.data?.releases ?? [];
  const plan = planPage(releases, {
    current: appVersion?.version,
    since,
    staged,
  });

  return (
    <div className="h-full overflow-y-auto scroll-fade-y select-text">
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 pb-8 @xl/app-content:px-6 @5xl/app-content:px-8 @5xl/app-content:pt-14">
        <div className="flex items-center justify-between gap-6 pb-10">
          <h1 className="font-serif text-3xl leading-10 font-normal">
            What's new
          </h1>
          {staged === undefined && <CheckForUpdates />}
        </div>
        {releasesQuery.isLoading ? (
          <LoadingEntries />
        ) : releasesQuery.isError ? (
          <Unavailable
            onRetry={() => {
              void releasesQuery.refetch();
            }}
          />
        ) : releases.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            There are no release notes yet.
          </p>
        ) : (
          <>
            {staged !== undefined && (
              <ReadyToInstall
                release={plan.staged}
                status={updateState?.type}
                version={staged}
              />
            )}
            {plan.newer.map((release) => (
              <FoldedEntry key={release.version} release={release} />
            ))}
            {plan.full.map((release) => (
              <Entry
                key={release.version}
                release={release}
                yours={release.version === plan.current}
              />
            ))}
            {plan.fresh && (
              <div className="flex items-center gap-3 pb-4 text-xs text-muted-foreground">
                Before this update
                <span className="h-px flex-1 bg-border" />
              </div>
            )}
            {plan.folded.map((release) => (
              <FoldedEntry key={release.version} release={release} />
            ))}
            <div className="flex justify-center pt-8">
              <Button asChild size="sm" variant="ghost">
                <ExternalLink href={RELEASE_NOTES_URL}>
                  All release notes
                  <ArrowSquareOutIcon />
                </ExternalLink>
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function releaseDate(publishedAt: string) {
  const date = new Date(publishedAt);
  return date.toLocaleDateString(displayLocale, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== new Date().getFullYear() && {
      year: "numeric",
    }),
  });
}

function Notes({ release }: { release: Release }) {
  const detail = detailOf(release);
  return (
    <div className="min-w-0">
      {release.summary && (
        <p className="text-[15px] leading-6">{release.summary}</p>
      )}
      {detail && (
        <div
          className={cn(
            "prose-session prose prose-custom prose-sm wrap-break-word dark:prose-invert prose-figcaption:text-sm prose-kbd:text-inherit prose-code:text-inherit prose-pre:text-sm prose-table:text-sm",
            release.summary && "mt-2",
          )}
        >
          <Markdown markdown={detail} />
        </div>
      )}
    </div>
  );
}

/** One version in full; the one running says so after its date. */
function Entry({
  release,
  yours = false,
}: {
  release: Release;
  yours?: boolean;
}) {
  return (
    <section className="grid gap-x-6 gap-y-2 pb-10 @xl/app-content:grid-cols-[8.5rem_1fr]">
      <div className="flex flex-wrap items-baseline gap-x-2 @xl/app-content:flex-col @xl/app-content:items-start">
        <h2 className="text-sm font-semibold">
          {versionLabel(release.version)}
        </h2>
        <div className="text-[13px] text-muted-foreground">
          {releaseDate(release.publishedAt)}
          {yours && " · Your version"}
        </div>
      </div>
      <Notes release={release} />
    </section>
  );
}

/** An older version as its opening line, opening to its notes on a press. */
function FoldedEntry({ release }: { release: Release }) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="pt-2">
        <Entry release={release} />
      </div>
    );
  }
  return (
    <button
      className="-mx-3 grid w-[calc(100%+1.5rem)] grid-cols-[1fr_auto] items-baseline gap-6 rounded-lg px-3 py-2.5 text-left hover:bg-foreground/4 @xl/app-content:grid-cols-[8.5rem_1fr_auto]"
      onClick={() => {
        setOpen(true);
      }}
      type="button"
    >
      <span className="flex items-baseline gap-2">
        <span className="text-sm font-medium whitespace-nowrap">
          {versionLabel(release.version)}
        </span>
        <span className="text-[13px] whitespace-nowrap text-muted-foreground">
          {releaseDate(release.publishedAt)}
        </span>
      </span>
      <span className="hidden truncate text-[13px] text-foreground/75 @xl/app-content:block">
        {release.summary ?? ""}
      </span>
      <CaretDownIcon className="size-3.5 text-muted-foreground" />
    </button>
  );
}

/** A downloaded build, ahead of everything else, with the restart beside it. */
function ReadyToInstall({
  release,
  status,
  version,
}: {
  release: Release | undefined;
  status: string | undefined;
  version: string;
}) {
  const { restart, restarting } = useRestartToUpdate(status);
  const busy = showsAsRestarting(restarting, status);
  return (
    <div className="mb-10 flex items-start gap-3 rounded-xl bg-brand-500/7 p-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-text">
        <ArrowsClockwiseIcon className="size-4.5" weight="bold" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">
          {versionLabel(version)} is ready to install
        </div>
        {release && (
          <div className="mt-1 text-[13px] leading-5 text-foreground/80">
            <Notes release={release} />
          </div>
        )}
      </div>
      <Button
        disabled={busy}
        onClick={() => {
          void restart();
        }}
        size="sm"
        variant="brand"
      >
        {busy ? "Restarting…" : "Restart to update"}
      </Button>
    </div>
  );
}

/**
 * Asks for a newer build, and says what it found where the button was: the
 * download it started shows as the page's ready update once it lands.
 */
function CheckForUpdates() {
  const check = useMutation(
    rpcClient.preferences.checkForUpdates.mutationOptions(),
  );
  const { data: updateState } = useQuery(
    rpcClient.updates.live.status.experimental_liveOptions(),
  );
  const status = updateState?.type;
  if (check.isSuccess && status === "not-available") {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <CheckCircleIcon className="size-4 text-brand-text" />
        You're on the newest version
      </span>
    );
  }
  const working =
    check.isPending ||
    status === "checking" ||
    status === "available" ||
    status === "downloading";
  return (
    <Button
      className="text-muted-foreground"
      disabled={working}
      onClick={() => {
        check.mutate(undefined);
      }}
      size="sm"
      variant="ghost"
    >
      {status === "downloading" || status === "available"
        ? "Downloading…"
        : working
          ? "Checking…"
          : "Check for updates"}
    </Button>
  );
}

function LoadingEntries() {
  return Array.from({ length: 2 }).map((_, i) => (
    <div
      className="grid gap-6 pb-10 @xl/app-content:grid-cols-[8.5rem_1fr]"
      key={i}
    >
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="mt-4 h-20 w-full" />
      </div>
    </div>
  ));
}

function Unavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-foreground/3 px-6 py-14 text-center">
      <WifiSlashIcon className="size-6 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground">
        We couldn't load the release notes. Check your connection and try again.
      </p>
      <Button onClick={onRetry} size="sm" variant="outline">
        Try again
      </Button>
    </div>
  );
}
