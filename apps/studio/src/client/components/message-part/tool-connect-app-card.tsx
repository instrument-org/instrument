import { Button } from "@/client/components/ui/button";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { ConnectControls } from "@/client/components/window/connect-controls";
import { WindowContext } from "@/client/components/window/context";
import {
  FixWithInstrumentButton,
  useFixConnection,
} from "@/client/components/window/fix-connection";
import {
  SignInWaitingLine,
  WaitingLine,
} from "@/client/components/window/sign-in-button";
import { useSiteSignIns } from "@/client/components/window/site-sign-in";
import { signInsWaitingAtom } from "@/client/components/window/use-sign-in-landing";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient, type RPCOutput } from "@/client/rpc/client";
import { type ConnectAppResult } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useContext, useState } from "react";

import { ToolCard } from "./tool-card";

type Row = Extract<ConnectAppResult, { state: "asked" }>;

type ListedApp = RPCOutput["apps"]["list"]["apps"][number];

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
 * each, and one way to pass on whatever is left, beside the title. One row is
 * up at a time and only it has anything to press: the first that needs the
 * user, or the one they pressed. Each row's
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
  const siteSignIns = useSiteSignIns();
  // The row the user pressed, up for as long as it has anything to press.
  const [picked, setPicked] = useState<string>();
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
  const kindOf = (row: Row) => kindNow(row, appOf(row.slug));
  // Whether a row has anything to press: not until each app's status is
  // read, not once it is answered, and not an app that wants no sign-in while
  // its connection is being tested.
  const asks = (row: Row) => {
    const status = statuses[rows.indexOf(row)];
    return (
      apps.data !== undefined &&
      status !== undefined &&
      !answered(status) &&
      !(kindOf(row) === "none" && status === "open")
    );
  };
  // The row that is up: the one pressed, else one off signing in in a
  // browser, else the first with anything to press.
  const up =
    rows.find((row) => row.slug === picked && asks(row)) ??
    rows.find((row) => statuses[rows.indexOf(row)] === "waiting") ??
    rows.find(asks);

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
            <span className="flex shrink-0 items-center">
              {connected.map((row) => (
                <AppIcon
                  icon={drawn.get(row.slug)?.icon}
                  key={row.slug}
                  name={row.name}
                  site={drawn.get(row.slug)?.site ?? row.site}
                  size="md"
                />
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
                line={siteSignIns.has(row.slug) ? "Waiting for you" : undefined}
                row={row}
                signInAgain
                status="declined"
                up
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
              key={row.slug}
              line={
                status === "waiting" ? (
                  <SignInWaitingLine
                    where={signInsWaiting.get(row.slug)?.where ?? "external"}
                  />
                ) : siteSignIns.has(row.slug) && !answered(status) ? (
                  row === up ? (
                    "Waiting for you"
                  ) : (
                    "Still waiting for you to sign in"
                  )
                ) : (
                  rowLine(status, row, appOf)
                )
              }
              {...(asks(row) && row !== up
                ? {
                    onPick: () => {
                      setPicked(row.slug);
                    },
                  }
                : {})}
              primary
              row={row}
              status={status}
              up={row === up}
            />
          );
        })}
      </div>
    </ToolCard>
  );
}

/**
 * What a row asks for as its app stands. An app moved to its site since the
 * card asked signs in there, and a local server that reads a key asks for it
 * once it is allowed.
 */
function kindNow(row: Row, app: ListedApp | undefined): Row["kind"] {
  return app?.type === "web"
    ? "web"
    : app?.type === "mcp-local" && app.status === "needs-key"
      ? "key"
      : row.kind;
}

/** The line under a row's name, saying where it stands. */
function rowLine(
  status: RowStatus,
  row: Row,
  appOf: (slug: string) => ListedApp | undefined,
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
      return connection?.keyRefused
        ? `${row.name} didn’t accept ${(appOf(row.slug)?.keys.length ?? 0) > 1 ? "these keys" : "this key"}.`
        : `${row.name} didn’t connect.`;
    }
    case "refused": {
      return `Direct connections aren’t available for ${row.name}.`;
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
 * One app's row, in a soft well: its mark, its name and where it stands. The
 * row that is up has what is left to press: a sign-in's button at the row's end,
 * and a key or a server to allow
 * open under it. A row waiting its turn is one button, which brings it up.
 */
function ConnectRow({
  line,
  onPick,
  primary = false,
  row,
  signInAgain = false,
  status,
  up,
}: {
  line: ReactNode;
  /** Brings the row up, for one with something to press that is waiting its turn. */
  onPick?: () => void;
  primary?: boolean;
  row: Row;
  /** For a skipped app on the folded card: the sign-in, offered again. */
  signInAgain?: boolean;
  status: RowStatus;
  /** Whether this is the row with its controls out. */
  up: boolean;
}) {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const drawn = useAppsBySlug().get(row.slug);
  const askedIn = useContext(WindowContext)?.chatId;
  const live =
    status === "open" ||
    status === "waiting" ||
    status === "failed" ||
    status === "refused";
  const failure =
    status === "failed" || status === "refused" ? status : undefined;
  const app = apps.data?.apps.find((entry) => entry.slug === row.slug);
  const kind = kindNow(row, app);
  const { fix, isFixing } = useFixConnection({
    name: row.name,
    slug: row.slug,
    updatedAt: app?.connection?.updatedAt,
  });
  const looksForAnother = failure !== undefined && isFixing;
  const actionable = up && (live || signInAgain) && !looksForAnother;
  const opens = kind === "key" || kind === "run";
  const isQuiet =
    status === "declined" || status === "removed" || onPick !== undefined;

  const head = (
    <>
      <AppIcon
        icon={drawn?.icon}
        name={row.name}
        site={drawn?.site ?? row.site}
        size="md"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn("truncate text-sm", isQuiet && "text-muted-foreground")}
        >
          {row.name}
        </span>
        {looksForAnother || line !== undefined ? (
          <span className="text-xs leading-4 text-muted-foreground">
            {looksForAnother ? (
              <WaitingLine>Looking for another way to connect</WaitingLine>
            ) : (
              line
            )}
          </span>
        ) : null}
      </div>
    </>
  );
  if (onPick !== undefined) {
    return (
      <button
        aria-label={row.name}
        className="flex min-h-13 w-full items-center gap-3 rounded-xl bg-foreground/[0.04] px-2.5 py-2 text-left outline-none hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onPick}
        type="button"
      >
        {head}
      </button>
    );
  }
  return (
    <div
      className={cn(
        "rounded-xl px-2.5",
        actionable && !signInAgain
          ? "bg-foreground/[0.06] ring-1 ring-foreground/10"
          : "bg-foreground/[0.04]",
      )}
    >
      <div
        className={cn(
          "flex min-h-13 items-center gap-3 py-2",
          kind === "web" && "@max-md/transcript:flex-wrap",
        )}
      >
        {head}
        {status === "connected" || status === "stale" ? (
          <CheckIcon
            className="size-4 shrink-0 text-brand-600 dark:text-brand-400"
            weight="bold"
          />
        ) : actionable &&
          (kind === "sign-in" ||
            kind === "web" ||
            (kind === "none" && failure !== undefined)) ? (
          <ConnectControls
            askedIn={askedIn}
            failure={failure}
            fix={fix}
            kind={kind === "none" ? "sign-in" : kind}
            name={row.name}
            primary={primary}
            slug={row.slug}
          />
        ) : null}
      </div>
      {actionable && opens ? (
        <div className="pb-2.5">
          <ConnectControls
            {...(failure && {
              alongside: <FixWithInstrumentButton onClick={fix} />,
            })}
            askedIn={askedIn}
            kind={kind}
            name={row.name}
            runs={row.runs}
            slug={row.slug}
          />
        </div>
      ) : null}
    </div>
  );
}
