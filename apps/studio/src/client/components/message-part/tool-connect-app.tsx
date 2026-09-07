import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { ConnectControls } from "@/client/components/orchestrator/connect-controls";
import { rpcClient } from "@/client/rpc/client";
import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";

import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";

type ConnectAppPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-connect_app" }
>;

/**
 * The card that asks the user for the one thing only they can give an app: a
 * sign-in, or a key. Drawn from the call that asked, but its state is the
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
  if (part.output.state === "failure") {
    return (
      <ToolCard>
        <ToolCardSection collapsedHeight={256}>
          <p className="text-sm text-muted-foreground">{part.output.message}</p>
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
  const { kind, name, runs, site, slug } = output;

  // The app's standing, live: the record the sign-in callback or the key
  // writes, which is what settles the card.
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const app = apps.data?.apps.find((entry) => entry.slug === slug);
  // A card from an earlier session may outlive its app: removed, or renamed
  // since. It says so rather than offering a sign-in to nothing.
  const removed = apps.data !== undefined && app === undefined;
  const standing = app?.standing;
  const settled =
    removed ||
    standing === "connected" ||
    standing === "declined" ||
    standing === "stale";
  const failed = standing === "failed";
  // What the service, the SDK, or the server said, kept whole and kept out of
  // the card's own sentences: it is machine text, usually one long line of it,
  // and the reader's use for it is to copy it somewhere rather than to read it
  // as prose.
  const detail = failed ? app?.connection?.error : undefined;

  return (
    <ToolCard>
      <ToolCardSection borderBottom={Boolean(detail)} collapsedHeight={320}>
        <div className="flex items-center gap-3">
          <AppIcon site={site} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {kind === "sign-in"
                ? `Sign in to ${name}`
                : kind === "key"
                  ? `${name} needs a key`
                  : kind === "run"
                    ? `${name} runs on this Mac`
                    : `Connect ${name}`}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">{reason}</p>
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
        ) : failed ? (
          // A failure the user can act on where they read about it: the same
          // controls the card opened with, since nothing about the app changed
          // and the next thing to do is the thing that did not work.
          <>
            <p className="mt-3 text-xs text-muted-foreground">
              Could not connect to {name}.
            </p>
            {kind === "none" ? null : (
              <div className="mt-3">
                <ConnectControls
                  dismissible
                  kind={kind}
                  label="Try again"
                  name={name}
                  runs={runs}
                  slug={slug}
                />
              </div>
            )}
          </>
        ) : kind === "none" ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Nothing to sign in to; Instrument is testing it.
          </p>
        ) : (
          <div className="mt-3">
            <ConnectControls
              dismissible
              kind={kind}
              name={name}
              runs={runs}
              slug={slug}
            />
          </div>
        )}
      </ToolCardSection>

      {detail ? (
        // Drawn as the transcript draws every other block of machine text: its
        // own region under the card's words, monospace, clamped to a few lines
        // with the rest a click away, and carrying the copy and wrap controls a
        // command's output carries. Wrapped by default so a single 300-
        // character line is readable in place; unwrapped for the reader
        // comparing indented lines.
        <ToolCardSection collapsedHeight={112} copyText={detail} wrappable>
          <pre className="font-mono text-xs leading-5 text-foreground/80">
            {detail}
          </pre>
        </ToolCardSection>
      ) : null}
    </ToolCard>
  );
}
