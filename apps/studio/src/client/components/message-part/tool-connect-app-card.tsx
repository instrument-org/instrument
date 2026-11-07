import { Button } from "@/client/components/ui/button";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import {
  ConnectControls,
  useDefaultBrowser,
} from "@/client/components/window/connect-controls";
import { WindowContext } from "@/client/components/window/context";
import { signInsWaitingAtom } from "@/client/components/window/use-sign-in-landing";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ConnectAppResult } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useContext, useState } from "react";

import { ToolCard } from "./tool-card";

type Row = Extract<ConnectAppResult, { state: "asked" }>;

/** Where a row stands, from its app's connection record. */
type RowStatus =
  | "connected"
  | "declined"
  | "failed"
  | "open"
  | "refused"
  | "removed"
  | "stale"
  | "waiting";

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * The card for a call that asked the user for apps, however many: a row for
 * each, and one way to pass on whatever is left, beside the title. Each row's
 * state is its app's connection record, live, so it says what happened wherever
 * it is seen and long after the call returned. Once no row is left to answer
 * the card folds to a line naming what was connected, with a row for each app
 * the user skipped.
 */
export function ConnectAppCard({
  reason,
  rows,
}: {
  reason: string;
  rows: Row[];
}) {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const drawn = useAppsBySlug();
  const signInsWaiting = useAtomValue(signInsWaitingAtom);
  const browser = useDefaultBrowser();
  const dismiss = useMutation(rpcClient.apps.dismiss.mutationOptions());

  const appOf = (slug: string) =>
    apps.data?.apps.find((entry) => entry.slug === slug);
  const statuses = rows.map((row): RowStatus => {
    if (apps.data === undefined) {
      return "open";
    }
    const app = appOf(row.slug);
    if (app === undefined) {
      return "removed";
    }
    // Another try at a failed sign-in waits like any other.
    if (signInsWaiting.has(row.slug) && app.status !== "connected") {
      return "waiting";
    }
    switch (app.status) {
      case "connected":
      case "declined":
      case "stale": {
        return app.status;
      }
      case "failed": {
        return app.connection?.ended === "refused" ? "refused" : "failed";
      }
      default: {
        return "open";
      }
    }
  });
  const answered = (status: RowStatus) =>
    status === "connected" ||
    status === "declined" ||
    status === "removed" ||
    status === "stale";
  const connected = rows.filter(
    (_, index) =>
      statuses[index] === "connected" || statuses[index] === "stale",
  );
  const skipped = rows.filter((_, index) => statuses[index] === "declined");
  const left = rows.filter((_, index) => {
    const status = statuses[index];
    return status !== undefined && !answered(status);
  });
  // The row lit as the one to press next: the first with anything to press,
  // and none while the user is off signing in to another.
  const next = statuses.includes("waiting")
    ? undefined
    : rows.find((_, index) => {
        const status = statuses[index];
        return status === "open" || status === "failed" || status === "refused";
      });

  const skipTheRest = () => {
    Promise.all(
      left.map((row) => dismiss.mutateAsync({ slug: row.slug })),
    ).catch((error: unknown) => {
      toast.error("Couldn't skip the rest", { cause: error });
    });
  };

  if (apps.data !== undefined && left.length === 0) {
    const [only] = rows;
    const onlyAlone = rows.length === 1 ? only : undefined;
    const removed = onlyAlone !== undefined && statuses[0] === "removed";
    const note = removed
      ? undefined
      : skipped.length > 0
        ? `You skipped ${LIST.format(skipped.map((row) => row.name))}.`
        : onlyAlone && statuses[0] === "stale"
          ? rowLine("stale", onlyAlone, appOf)
          : onlyAlone && appOf(onlyAlone.slug)?.connection?.account
            ? rowLine("connected", onlyAlone, appOf)
            : undefined;
    return (
      <ToolCard>
        <div className="flex items-center gap-3 px-4 py-3">
          {connected.length > 0 ? (
            <span className="flex shrink-0 items-center -space-x-2">
              {connected.map((row) => (
                <span className="rounded-lg ring-2 ring-card" key={row.slug}>
                  <AppIcon
                    icon={drawn.get(row.slug)?.icon}
                    name={row.name}
                    site={drawn.get(row.slug)?.site ?? row.site}
                    size="md"
                  />
                </span>
              ))}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {removed
                ? `${onlyAlone.name} was removed`
                : connected.length === 0
                  ? "No apps connected"
                  : connected.length === 1
                    ? `${connected[0]?.name ?? "One app"} connected`
                    : `${connected.length} apps connected`}
            </p>
            {note ? (
              <p className="text-xs leading-5 text-muted-foreground">{note}</p>
            ) : null}
          </div>
        </div>
        {skipped.length > 0 ? (
          <div className="flex flex-col gap-1.5 px-3 pb-3">
            {skipped.map((row) => (
              <ConnectRow
                key={row.slug}
                line={undefined}
                row={row}
                signInAgain
                status="declined"
              />
            ))}
          </div>
        ) : null}
      </ToolCard>
    );
  }

  return (
    <ToolCard>
      <div className="px-4 pt-3.5 pb-2.5">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm font-medium">
            {rows.length <= 2
              ? `Connect ${LIST.format(rows.map((row) => row.name))}`
              : `Connect ${rows.length} apps`}
          </p>
          {/* Sized down into the title's line, its words ending where the
            rows' buttons do. */}
          <Button
            className="-my-1.5 -mr-1.5 shrink-0 text-muted-foreground"
            // Only once each app's status is read, so nothing connected is skipped.
            disabled={apps.data === undefined || dismiss.isPending}
            onClick={skipTheRest}
            size="sm"
            variant="ghost"
          >
            {left.length === rows.length ? "Not now" : "Skip the rest"}
          </Button>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{reason}</p>
      </div>
      <div className="flex flex-col gap-1.5 px-3 pb-3">
        {rows.map((row, index) => {
          const status = statuses[index] ?? "open";
          return (
            <ConnectRow
              alone={rows.length === 1}
              key={row.slug}
              line={
                status === "waiting"
                  ? signInsWaiting.get(row.slug)?.where === "external"
                    ? `Finish signing in in ${browser.data?.appName ?? "your browser"}.`
                    : "Finish signing in on the page that opened."
                  : rowLine(status, row, appOf)
              }
              primary={row === next}
              row={row}
              status={status}
            />
          );
        })}
      </div>
    </ToolCard>
  );
}

/** The line under a row's name, saying where it stands. */
function rowLine(
  status: RowStatus,
  row: Row,
  appOf: (
    slug: string,
  ) => { connection?: { account?: string; ended?: string } } | undefined,
): string | undefined {
  const connection = appOf(row.slug)?.connection;
  switch (status) {
    case "connected": {
      return connection?.account === undefined
        ? "Connected"
        : `Connected as ${connection.account}`;
    }
    case "declined": {
      return "Skipped";
    }
    case "failed": {
      return `Instrument couldn’t connect to ${row.name}.`;
    }
    case "refused": {
      return `${row.name} won’t let this account connect directly.`;
    }
    case "removed": {
      return "This app was removed.";
    }
    case "stale": {
      return "It changed since it connected, so Instrument will test it again.";
    }
    case "open": {
      if (connection?.ended === "expired") {
        return "That sign-in timed out.";
      }
      return row.kind === "none"
        ? "This app doesn’t need a sign-in. Instrument is testing the connection."
        : undefined;
    }
    case "waiting": {
      return undefined;
    }
  }
}

/**
 * One app's row, in a soft well: its mark, its name and where it stands, and
 * what is left to press. A sign-in fits in the row, its buttons dropping under
 * the name in a narrow chat; a key or a server to allow opens under it, by
 * itself when it is all the card asks for, and so does the word that a sign-in
 * on the app's site is done.
 */
function ConnectRow({
  alone = false,
  line,
  primary = false,
  row,
  signInAgain = false,
  status,
}: {
  /** The only app on its card, so what it asks for needs no press to open. */
  alone?: boolean;
  line: string | undefined;
  primary?: boolean;
  row: Row;
  /** For a skipped app on the folded card: the sign-in, offered again. */
  signInAgain?: boolean;
  status: RowStatus;
}) {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const drawn = useAppsBySlug().get(row.slug);
  const askedIn = useContext(WindowContext)?.chatId;
  const [expanded, setExpanded] = useState(alone);
  // The app's site was opened from this row, so the row asks for the word
  // that the sign-in there is done.
  const [openedSite, setOpenedSite] = useState(false);
  const live =
    status === "open" ||
    status === "waiting" ||
    status === "failed" ||
    status === "refused";
  const actionable = live || signInAgain;
  const failure =
    status === "failed" || status === "refused" ? status : undefined;
  const app = apps.data?.apps.find((entry) => entry.slug === row.slug);
  // An app moved to its site since the card asked signs in there.
  const kind = app?.type === "web" ? "web" : row.kind;
  const opens = kind === "key" || kind === "run";

  return (
    <div className="rounded-xl bg-foreground/[0.04] px-2.5">
      <div className="flex min-h-13 items-center gap-3 py-2 @max-md/transcript:flex-wrap">
        <AppIcon
          icon={drawn?.icon}
          name={row.name}
          site={drawn?.site ?? row.site}
          size="md"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm",
              (status === "declined" || status === "removed") &&
                "text-muted-foreground",
            )}
          >
            {row.name}
          </span>
          {line === undefined ? null : (
            <span className="text-xs leading-4 text-muted-foreground">
              {line}
            </span>
          )}
        </div>
        {status === "connected" || status === "stale" ? (
          <CheckIcon
            className="size-4 shrink-0 text-brand-600 dark:text-brand-400"
            weight="bold"
          />
        ) : !actionable || openedSite ? null : kind === "sign-in" ||
          kind === "web" ||
          (kind === "none" && failure !== undefined) ? (
          <ConnectControls
            askedIn={askedIn}
            compact={{
              ...(failure && { failure }),
              hasSite: app?.site !== undefined,
              primary,
            }}
            kind={kind === "none" ? "sign-in" : kind}
            name={row.name}
            onOpened={() => {
              setOpenedSite(true);
            }}
            slug={row.slug}
          />
        ) : opens && !expanded ? (
          <Button
            className={primary ? undefined : "text-foreground"}
            onClick={() => {
              setExpanded(true);
            }}
            size="sm"
            variant={primary ? "brand" : "outline"}
          >
            {kind === "key" ? "Add key" : "Allow"}
          </Button>
        ) : null}
      </div>
      {actionable && opens && expanded ? (
        <div className="pb-2.5">
          <ConnectControls
            askedIn={askedIn}
            kind={kind}
            name={row.name}
            runs={row.runs}
            slug={row.slug}
          />
        </div>
      ) : null}
      {actionable && openedSite ? (
        <div className="pb-2.5">
          <ConnectControls
            askedIn={askedIn}
            kind="web"
            name={row.name}
            opened
            slug={row.slug}
          />
        </div>
      ) : null}
    </div>
  );
}
