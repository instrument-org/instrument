import { Button } from "@/client/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/client/components/ui/collapsible";
import { AppIcon } from "@/client/components/window/app-icon";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { WindowContext } from "@/client/components/window/context";
import { toast } from "@/client/lib/toast";
import { osConventions } from "@/client/lib/utils";
import { ConnectControls } from "@/client/components/window/connect-controls";
import { rpcClient } from "@/client/rpc/client";
import {
  askedOnCard,
  type CardRow,
  type ConnectAppResult,
  connectAppResults,
  type ChatId,
  type SessionMessagePart,
  type SignInAsk,
} from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext, useState } from "react";

import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";
import { ConnectAppGroupCard } from "./tool-connect-app-group";

type ConnectAppPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-connect_app" }
>;

/**
 * The card that asks the user for the one thing only they can give an app: a
 * sign-in (on the service's own site, for a web app), or a key. Drawn from the call that asked, but its state is the
 * app's connection record, so it says what happened wherever it is seen and
 * long after the call returned. The agent hears the outcome as a note, never
 * the credential.
 */
export function ToolConnectApp({ part }: { part: ConnectAppPart }) {
  const chatId = useContext(WindowContext)?.chatId;
  // The sign-in this call put up, still up or not, which says the computer
  // that asked: signing in happens there alone, where its sign-ins and keys
  // are, so another computer's call never offers this one's controls.
  const signIn = useQuery(
    chatId === undefined
      ? { enabled: false, queryKey: ["no-chat-sign-in"] }
      : rpcClient.workspace.chats.live.signIn.experimental_liveOptions({
          input: { id: chatId, partId: part.metadata.id },
        }),
  );
  if (!part.input) {
    return <ToolCardEmpty message="The request has not arrived yet." />;
  }
  if (part.state !== "output-available") {
    return null;
  }
  if (chatId !== undefined) {
    // Which computer asked is not known yet: neither card, rather than
    // controls that might be the wrong computer's.
    if (signIn.data === undefined) {
      return null;
    }
    if (signIn.data !== null && !signIn.data.here) {
      return (
        <RemoteSignInCard
          ask={signIn.data}
          chatId={chatId}
          rows={askedOnCard(part.output)}
          reason={part.input.reason}
        />
      );
    }
  }
  const results = connectAppResults(part.output);
  const rows = askedOnCard(part.output);
  // A card for every app that needs the user, several to a card; one app's
  // card has room for all of its controls.
  if (rows.length > 1) {
    return <ConnectAppGroupCard reason={part.input.reason} rows={rows} />;
  }
  const asked = rows[0] ?? results.find((result) => result.state === "asked");
  if (asked !== undefined) {
    return <ConnectCard output={asked} reason={part.input.reason} />;
  }
  return (
    <ToolCard>
      <ToolCardSection collapsedHeight={256}>
        {results.map((result) => (
          <p className="text-sm text-muted-foreground" key={result.slug}>
            {result.state === "failure"
              ? result.message
              : `${result.name} is already connected.`}
          </p>
        ))}
      </ToolCardSection>
    </ToolCard>
  );
}

/**
 * A sign-in card another computer put up: its rows as that computer last
 * wrote them, since signing in happens there, where its sign-ins and keys
 * are. This device may say Not now to the whole card.
 */
function RemoteSignInCard({
  ask,
  chatId,
  reason,
  rows,
}: {
  ask: SignInAsk & { live: boolean };
  chatId: ChatId;
  reason: string;
  /** The call's rows, which say what it asked of each app, for the title the asking computer shows. */
  rows: CardRow[];
}) {
  const [only] = ask.apps;
  const row = rows.find((each) => each.slug === only?.slug);
  // An app moved to the web signs in there, as the asking computer reads it
  // from the app's folder, which syncs.
  const onWeb =
    useQuery(
      rpcClient.apps.live.list.experimental_liveOptions(),
    ).data?.apps.find((entry) => entry.slug === only?.slug)?.type === "web";
  const kind = onWeb ? "web" : (row?.kind ?? "sign-in");
  const decline = useMutation(
    rpcClient.workspace.chats.declineSignIn.mutationOptions({
      onError: (error: Error) => {
        toast.error("Couldn't send your answer", { cause: error });
      },
    }),
  );
  return (
    <ToolCard>
      <div className="px-4 py-3">
        <p className="text-sm font-medium">
          {ask.apps.length === 1
            ? connectTitle(kind, only?.name ?? "the app", ask.computer)
            : `Connect ${ask.apps.length} apps`}
        </p>
        <p className="text-xs leading-5 text-muted-foreground">{reason}</p>
      </div>
      {ask.apps.map((app) => (
        <div
          className="flex min-h-11 items-center gap-3 border-t border-border px-4 py-1.5"
          key={app.slug}
        >
          <span className="min-w-0 flex-1 truncate text-sm">{app.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {remoteRowLine(app)}
          </span>
        </div>
      ))}
      {ask.live ? (
        <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-1.5">
          <span className="text-xs text-muted-foreground">
            {ask.answered
              ? `You said not now from ${ask.answered.by}. It takes effect once ${ask.computer} picks it up.`
              : `You can sign in on ${ask.computer}.`}
          </span>
          {ask.answerable ? (
            <Button
              disabled={decline.isPending}
              onClick={() => {
                decline.mutate({ askId: ask.id, id: chatId });
              }}
              size="sm"
              variant="ghost"
            >
              Not now
            </Button>
          ) : null}
        </div>
      ) : null}
    </ToolCard>
  );
}

/** A one-app card's title, the same on every computer: what the app needs. */
function connectTitle(
  kind: Extract<ConnectAppResult, { state: "asked" }>["kind"],
  name: string,
  computer: string,
): string {
  switch (kind) {
    case "sign-in": {
      return `Sign in to ${name}`;
    }
    case "web": {
      return `Sign in to ${name} on the web`;
    }
    case "key": {
      return `${name} needs a key`;
    }
    case "run": {
      return `${name} runs on ${computer}`;
    }
    default: {
      return `Connect ${name}`;
    }
  }
}

/** Where a row of another computer's sign-in stands, as that computer last wrote it. */
function remoteRowLine(app: { account?: string; standing: string }): string {
  switch (app.standing) {
    case "connected": {
      return app.account === undefined
        ? "Connected"
        : `Connected as ${app.account}`;
    }
    case "declined": {
      return "Skipped";
    }
    case "failed": {
      return "The sign-in didn’t go through.";
    }
    default: {
      return "Not signed in yet";
    }
  }
}

function ConnectCard({
  output,
  reason,
}: {
  output: Extract<ConnectAppResult, { state: "asked" }>;
  reason: string;
}) {
  const { name, runs, site, slug } = output;
  // Whether this card moved the app to the web and opened its site, so the
  // controls ask for the word that the sign-in there is done.
  const [movedToWeb, setMovedToWeb] = useState(false);

  // The app's standing, live: the record the sign-in callback or the key
  // writes, which is what settles the card.
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const app = apps.data?.apps.find((entry) => entry.slug === slug);
  // Its face as every other surface draws it, which outlives a removed app.
  const drawn = useAppsBySlug().get(slug);
  // A card from an earlier session may outlive its app: removed, or renamed
  // since. It says so rather than offering a sign-in to nothing.
  const removed = apps.data !== undefined && app === undefined;
  const standing = app?.standing;
  // An app moved to the web since the card was drawn signs in there.
  const kind = app?.type === "web" ? "web" : output.kind;
  const settled =
    removed ||
    standing === "connected" ||
    standing === "declined" ||
    standing === "stale";
  const failed = standing === "failed";
  const ended = app?.connection?.ended;
  // A sign-in of the app's own, or a server that wanted none, that did not
  // connect: the service's site is the next step.
  const webOffered = kind === "sign-in" || kind === "none";
  // What the service, the SDK, or the server said, kept whole and kept out of
  // the card's own sentences: it is machine text, usually one long line of it,
  // and the reader's use for it is to copy it somewhere rather than to read it
  // as prose. A sign-in stopped or left to lapse has none worth showing.
  const detail =
    failed && ended !== "canceled" && ended !== "expired"
      ? app?.connection?.error
      : undefined;
  const signInOnWeb = (
    <SignInOnWebButton
      onOpened={() => {
        setMovedToWeb(true);
      }}
      slug={slug}
    />
  );

  return (
    <ToolCard>
      {/* What the service said sits behind "Details", closed until asked
          for: the line above the buttons already says what happened. */}
      <Collapsible>
        <ToolCardSection collapsedHeight={320}>
          <div className="flex items-center gap-3">
            <AppIcon
              icon={drawn?.icon}
              name={name}
              site={drawn?.site ?? site}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {connectTitle(kind, name, osConventions().thisComputer)}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {reason}
              </p>
            </div>
          </div>

          {settled ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {removed
                ? `${name} was removed.`
                : standing === "connected"
                  ? `Connected${app?.connection?.account ? ` as ${app.connection.account}` : ""}.`
                  : standing === "declined"
                    ? "Not now."
                    : "Connected, then changed; Instrument will test it again."}
            </p>
          ) : failed && kind !== "web" ? (
            // A failure the user can act on where they read about it. A sign-in
            // that did not connect goes on to the service's site, with another
            // try beside it; anything else offers the same controls again,
            // since the next thing to do is the thing that did not work.
            <>
              <p className="mt-3 text-xs text-muted-foreground">
                {failedLine({ ended, name, webOffered })}
              </p>
              {kind === "none" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {signInOnWeb}
                </div>
              ) : (
                <div className="mt-3">
                  <ConnectControls
                    // Where the direct sign-in goes says nothing about the web.
                    describesDestination={!webOffered}
                    dismissible
                    kind={kind}
                    label="Try again"
                    leading={webOffered ? signInOnWeb : undefined}
                    name={name}
                    runs={runs}
                    slug={slug}
                  />
                </div>
              )}
            </>
          ) : kind === "none" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              This app doesn’t need a sign-in. Instrument is testing the
              connection.
            </p>
          ) : (
            <div className="mt-3">
              <ConnectControls
                dismissible
                kind={kind}
                name={name}
                opened={movedToWeb}
                runs={runs}
                slug={slug}
              />
            </div>
          )}
          {detail ? (
            <CollapsibleTrigger className="group mt-3 flex items-center gap-1 text-xs text-muted-foreground">
              <CaretRightIcon className="size-3 transition-transform group-data-[state=open]:rotate-90" />
              Details
            </CollapsibleTrigger>
          ) : null}
        </ToolCardSection>

        {detail ? (
          // Drawn as the transcript draws every other block of machine text: its
          // own region under the card's words, monospace, clamped to a few lines
          // with the rest a click away, and carrying the copy and wrap controls a
          // command's output carries. Wrapped by default so a single 300-
          // character line is readable in place; unwrapped for the reader
          // comparing indented lines.
          <CollapsibleContent className="border-t border-border">
            <ToolCardSection collapsedHeight={112} copyText={detail} wrappable>
              <pre className="font-mono text-xs leading-5 text-foreground/80">
                {detail}
              </pre>
            </ToolCardSection>
          </CollapsibleContent>
        ) : null}
      </Collapsible>
    </ToolCard>
  );
}

/** What the card says when connecting did not work, and what it offers next. */
function failedLine({
  ended,
  name,
  webOffered,
}: {
  ended: "canceled" | "expired" | "refused" | undefined;
  name: string;
  webOffered: boolean;
}): string {
  if (!webOffered) {
    return `Could not connect to ${name}.`;
  }
  switch (ended) {
    case "canceled": {
      return `Signing in to ${name} stopped before it finished. You can sign in on the web instead, or try again.`;
    }
    case "expired": {
      return `The sign-in to ${name} timed out. You can sign in on the web instead, or try again.`;
    }
    case "refused": {
      return `${name} won’t let this account connect directly. You can sign in to ${name} on the web instead.`;
    }
    case undefined: {
      return `Instrument couldn’t connect to ${name}. You can sign in on the web instead, or try again.`;
    }
  }
}

/**
 * Moves the app to the service's site and opens it in the window's browser,
 * where the site's own sign-in works and its cookies keep it.
 */
function SignInOnWebButton({
  onOpened,
  slug,
}: {
  onOpened: () => void;
  slug: string;
}) {
  const appWindow = useContext(WindowContext);
  const move = useMutation(
    rpcClient.apps.signInOnWeb.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't open the site", { cause: error });
      },
      onSuccess: ({ signIn }) => {
        appWindow?.openPage(signIn);
        onOpened();
      },
    }),
  );
  return (
    <Button
      disabled={move.isPending || !appWindow?.browser}
      onClick={() => {
        move.mutate({ slug });
      }}
      size="sm"
    >
      Sign in on the web
    </Button>
  );
}
