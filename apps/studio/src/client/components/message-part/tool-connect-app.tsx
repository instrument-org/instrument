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
import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useContext, useState } from "react";

import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";

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
  if (!part.input) {
    return <ToolCardEmpty message="The request has not arrived yet." />;
  }
  if (part.state !== "output-available") {
    return null;
  }
  if (part.output.state === "failure" || part.output.state === "connected") {
    return (
      <ToolCard>
        <ToolCardSection collapsedHeight={256}>
          <p className="text-sm text-muted-foreground">
            {part.output.state === "failure"
              ? part.output.message
              : `${part.output.name} is already connected.`}
          </p>
        </ToolCardSection>
      </ToolCard>
    );
  }
  return <ConnectCard output={part.output} reason={part.input.reason} />;
}

function ConnectCard({
  output,
  reason,
}: {
  output: Extract<
    Extract<ConnectAppPart, { state: "output-available" }>["output"],
    { state: "asked" }
  >;
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
                {kind === "sign-in"
                  ? `Sign in to ${name}`
                  : kind === "web"
                    ? `Sign in to ${name} on the web`
                    : kind === "key"
                      ? `${name} needs a key`
                      : kind === "run"
                        ? `${name} runs on ${osConventions().thisComputer}`
                        : `Connect ${name}`}
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
