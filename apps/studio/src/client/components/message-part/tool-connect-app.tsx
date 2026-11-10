import { Button } from "@/client/components/ui/button";
import { WindowContext } from "@/client/components/window/context";
import { toast } from "@/client/lib/toast";
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
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useContext } from "react";

import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";
import { ConnectAppCard } from "./tool-connect-app-card";

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
      ? { queryFn: skipToken, queryKey: ["no-chat-sign-in"] }
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
  // One card for every app that needs the user, however many. An app that
  // wanted no sign-in has no row beside others, but on its own it says so.
  const asked = results.find((result) => result.state === "asked");
  if (rows.length > 0 || asked !== undefined) {
    return (
      <ConnectAppCard
        reason={part.input.reason}
        rows={rows.length > 0 || asked === undefined ? rows : [asked]}
      />
    );
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
              ? `You said not now from ${ask.answered.by}. ${ask.computer} needs to be on for it to take effect.`
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
