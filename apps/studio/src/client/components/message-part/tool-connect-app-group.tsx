import { Button } from "@/client/components/ui/button";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { ConnectControls } from "@/client/components/window/connect-controls";
import { WindowContext } from "@/client/components/window/context";
import { signInsWaitingAtom } from "@/client/components/window/use-sign-in-landing";
import { toast } from "@/client/lib/toast";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type CardRow } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useContext, useState } from "react";

import { ToolCard } from "./tool-card";

type Row = CardRow;

/** Where a row stands, from its app's connection record. */
type RowStanding =
  | "connected"
  | "declined"
  | "failed"
  | "open"
  | "removed"
  | "stale"
  | "waiting";

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

/**
 * The card for a call that asked for several apps at once: a row for each,
 * a count of how many are connected, and "Skip the rest" for whatever is
 * left. Like the card for one app, each row's state is its app's connection
 * record, live. Once no row is left to answer the card folds to a line
 * naming what was connected, with a row for each app the user skipped.
 */
export function ConnectAppGroupCard({
  reason,
  rows,
}: {
  reason: string;
  rows: Row[];
}) {
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const drawn = useAppsBySlug();
  const signInsWaiting = useAtomValue(signInsWaitingAtom);
  const dismiss = useMutation(rpcClient.apps.dismiss.mutationOptions());

  const standings = rows.map((row): RowStanding => {
    if (apps.data === undefined) {
      return "open";
    }
    const app = apps.data.apps.find((entry) => entry.slug === row.slug);
    if (app === undefined) {
      return "removed";
    }
    switch (app.standing) {
      case "connected":
      case "declined":
      case "failed":
      case "stale": {
        return app.standing;
      }
      default: {
        return signInsWaiting.has(row.slug) ? "waiting" : "open";
      }
    }
  });
  const accountOf = (slug: string) =>
    apps.data?.apps.find((entry) => entry.slug === slug)?.connection?.account;
  const answered = (standing: RowStanding) =>
    standing === "connected" ||
    standing === "declined" ||
    standing === "removed" ||
    standing === "stale";
  const connected = rows.filter(
    (_, index) =>
      standings[index] === "connected" || standings[index] === "stale",
  );
  const skipped = rows.filter((_, index) => standings[index] === "declined");
  const left = rows.filter((_, index) => {
    const standing = standings[index];
    return standing !== undefined && !answered(standing);
  });
  // The row lit as the one to press next: the first nobody has started on.
  const next = rows.find((_, index) => standings[index] === "open");

  const skipTheRest = () => {
    Promise.all(
      left.map((row) => dismiss.mutateAsync({ slug: row.slug })),
    ).catch((error: unknown) => {
      toast.error("Couldn't skip the rest", { cause: error });
    });
  };

  if (apps.data !== undefined && left.length === 0) {
    return (
      <ToolCard>
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {connected.length === 0
                ? "No apps connected"
                : connected.length === 1
                  ? `${connected[0]?.name ?? "One app"} connected`
                  : `${connected.length} apps connected`}
            </p>
            {skipped.length > 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {`You skipped ${LIST.format(skipped.map((row) => row.name))}.`}
              </p>
            ) : null}
          </div>
          <span className="flex shrink-0 items-center -space-x-1">
            {connected.map((row) => (
              <span className="rounded-[4px] ring-2 ring-card" key={row.slug}>
                <AppIcon
                  icon={drawn.get(row.slug)?.icon}
                  name={row.name}
                  site={drawn.get(row.slug)?.site ?? row.site}
                  size="sm"
                />
              </span>
            ))}
          </span>
        </div>
        {skipped.map((row) => (
          <GroupRow
            key={row.slug}
            line={undefined}
            row={row}
            signInAgain
            standing="declined"
          />
        ))}
      </ToolCard>
    );
  }

  return (
    <ToolCard>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{`Connect ${rows.length} apps`}</p>
            <p className="text-xs leading-5 text-muted-foreground">{reason}</p>
          </div>
          <span className="shrink-0 text-xs font-medium text-foreground/80">
            {`${connected.length} of ${rows.length} connected`}
          </span>
        </div>
        <div aria-hidden className="mt-3 flex gap-1">
          {standings.map((standing, index) => (
            <span
              className={cn(
                "h-1 flex-1 rounded-full",
                standing === "connected" || standing === "stale"
                  ? "bg-brand-600"
                  : standing === "declined" || standing === "removed"
                    ? "bg-muted-foreground/30"
                    : standing === "waiting"
                      ? "bg-brand-200"
                      : "bg-foreground/8",
              )}
              key={rows[index]?.slug ?? index}
            />
          ))}
        </div>
      </div>
      {rows.map((row, index) => {
        const standing = standings[index] ?? "open";
        const account = accountOf(row.slug);
        return (
          <GroupRow
            key={row.slug}
            line={rowLine(standing, account)}
            primary={row === next}
            row={row}
            standing={standing}
          />
        );
      })}
      <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-1.5">
        <span className="text-xs text-muted-foreground">
          {`Waiting on ${left.length} more.`}
        </span>
        <Button
          // Only once each app's standing is read, so nothing connected is skipped.
          disabled={apps.data === undefined || dismiss.isPending}
          onClick={skipTheRest}
          size="sm"
          variant="ghost"
        >
          Skip the rest
        </Button>
      </div>
    </ToolCard>
  );
}

/** The line under a row's name, saying where it stands. */
function rowLine(
  standing: RowStanding,
  account: string | undefined,
): string | undefined {
  switch (standing) {
    case "connected": {
      return account === undefined ? "Connected" : `Connected as ${account}`;
    }
    case "declined": {
      return "Skipped";
    }
    case "failed": {
      return "The sign-in didn’t go through.";
    }
    case "removed": {
      return "This app was removed.";
    }
    case "stale": {
      return "It changed since it connected, so Instrument will test it again.";
    }
    case "waiting": {
      return "Finish signing in in your browser.";
    }
    case "open": {
      return undefined;
    }
  }
}

/**
 * One app's row: its mark, its name and where it stands, and what is left
 * to press. A sign-in fits in the row; a key, a server to allow, or a sign-in
 * on the web opens under it with the controls the card for one app has.
 */
function GroupRow({
  line,
  primary = false,
  row,
  signInAgain = false,
  standing,
}: {
  line: string | undefined;
  primary?: boolean;
  row: Row;
  /** For a skipped app on the folded card: Sign in, with no Skip beside it. */
  signInAgain?: boolean;
  standing: RowStanding;
}) {
  const drawn = useAppsBySlug().get(row.slug);
  const askedIn = useContext(WindowContext)?.chatId;
  const [expanded, setExpanded] = useState(false);
  const live =
    standing === "open" || standing === "waiting" || standing === "failed";
  const actionable = live || signInAgain;
  const label = standing === "failed" ? "Try again" : "Sign in";

  return (
    <div className="border-t border-border px-4">
      <div className="flex min-h-11 items-center gap-3 py-1.5">
        <AppIcon
          icon={drawn?.icon}
          name={row.name}
          site={drawn?.site ?? row.site}
          size="sm"
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(
              "truncate text-sm",
              (standing === "declined" || standing === "removed") &&
                "text-muted-foreground",
            )}
          >
            {row.name}
          </span>
          {line === undefined ? null : (
            <span className="truncate text-xs leading-4 text-muted-foreground">
              {line}
            </span>
          )}
        </div>
        {standing === "connected" || standing === "stale" ? (
          <CheckIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : !actionable ? null : row.kind === "sign-in" ? (
          <ConnectControls
            askedIn={askedIn}
            compact={{ primary }}
            dismissible={!signInAgain}
            kind="sign-in"
            label={label}
            name={row.name}
            slug={row.slug}
          />
        ) : expanded ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              onClick={() => {
                setExpanded(true);
              }}
              size="sm"
              variant={primary ? "brand" : "default"}
            >
              {row.kind === "key"
                ? "Add key"
                : row.kind === "run"
                  ? "Allow"
                  : label}
            </Button>
            {signInAgain ? null : <SkipButton slug={row.slug} />}
          </div>
        )}
      </div>
      {expanded && actionable && row.kind !== "sign-in" ? (
        <div className="pb-3">
          <ConnectControls
            askedIn={askedIn}
            dismissible={!signInAgain}
            kind={row.kind}
            name={row.name}
            runs={row.runs}
            slug={row.slug}
          />
        </div>
      ) : null}
    </div>
  );
}

function SkipButton({ slug }: { slug: string }) {
  const dismiss = useMutation(rpcClient.apps.dismiss.mutationOptions());
  return (
    <Button
      disabled={dismiss.isPending}
      onClick={() => {
        dismiss.mutate({ slug });
      }}
      size="sm"
      variant="ghost"
    >
      Skip
    </Button>
  );
}
