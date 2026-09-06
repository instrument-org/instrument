import { AppIcon } from "@/client/components/orchestrator/app-icon";
import { OrchestratorContext } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { type SessionMessagePart } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useContext, useState } from "react";
import { toast } from "sonner";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ToolCard, ToolCardEmpty, ToolCardSection } from "./tool-card";

type ConnectAppPart = Extract<
  SessionMessagePart.ToolPart,
  { type: "tool-connect_app" }
>;

/**
 * The card that asks the user for the one thing only they can give an app: a
 * sign-in, or a key. Drawn from the call that asked, but its state is the
 * app's connection record, so it says what happened wherever it is seen and
 * long after the call returned. Sign in opens the provider's page in the
 * window's own browser; the key goes straight to the encrypted store. The
 * agent hears the outcome as a note, never the credential.
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
  const { kind, name, site, slug } = output;
  const orchestrator = useContext(OrchestratorContext);
  const navigate = useNavigate();
  const openExternalLink = useOpenExternalLink();
  const [value, setValue] = useState("");
  const [waiting, setWaiting] = useState(false);

  // The app's standing, live: the record the sign-in callback or the key
  // writes, which is what settles the card.
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const app = apps.data?.apps.find((entry) => entry.slug === slug);
  const standing = app?.standing;
  const settled =
    standing === "connected" ||
    standing === "declined" ||
    standing === "failed" ||
    standing === "stale";

  const openAuthorization = (url: string) => {
    if (orchestrator?.browser) {
      // The window's own browser, where the callback lands too, rather than
      // the user's, which knows nothing about the agent driving beside it.
      orchestrator.browser.open(url);
      void navigate({ to: "/orchestrator/browser" });
    } else {
      openExternalLink(url, { addReferral: false });
    }
  };

  const startOAuth = useMutation(
    rpcClient.apps.startOAuth.mutationOptions({
      onError: (error) => {
        toast.error("Could not start the sign-in", {
          description: error.message,
        });
      },
      onSuccess: (result) => {
        if (result.status === "started") {
          setWaiting(true);
          openAuthorization(result.url);
        }
      },
    }),
  );
  const cancelOAuth = useMutation(
    rpcClient.apps.cancelOAuth.mutationOptions({
      onSuccess: () => {
        setWaiting(false);
      },
    }),
  );
  const dismiss = useMutation(rpcClient.apps.dismiss.mutationOptions());
  const setCredential = useMutation(
    rpcClient.apps.setCredential.mutationOptions({
      onError: (error) => {
        toast.error("Could not save the key", { description: error.message });
      },
      onSuccess: () => {
        setValue("");
      },
    }),
  );

  const busy =
    startOAuth.isPending ||
    cancelOAuth.isPending ||
    dismiss.isPending ||
    setCredential.isPending;

  return (
    <ToolCard>
      <ToolCardSection collapsedHeight={320}>
        <div className="flex items-center gap-3">
          <AppIcon site={site} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {kind === "sign-in"
                ? `Sign in to ${name}`
                : kind === "key"
                  ? `${name} needs a key`
                  : `Connect ${name}`}
            </p>
            <p className="text-xs leading-5 text-muted-foreground">{reason}</p>
          </div>
        </div>

        {settled ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {standing === "connected"
              ? `Connected${app?.connection?.account ? ` as ${app.connection.account}` : ""}.`
              : standing === "declined"
                ? "Not now."
                : standing === "stale"
                  ? "Connected, then changed; Instrument will test it again."
                  : `Could not connect${app?.connection?.error ? `: ${app.connection.error}` : "."}`}
          </p>
        ) : kind === "sign-in" ? (
          <div className="mt-3 flex items-center gap-2">
            <GlyphButton
              disabled={busy || waiting}
              onClick={() => {
                startOAuth.mutate({ slug });
              }}
            >
              {waiting ? "Waiting for the sign-in…" : `Sign in to ${name}`}
            </GlyphButton>
            <Button
              disabled={busy}
              onClick={() => {
                if (waiting) {
                  cancelOAuth.mutate({ slug });
                } else {
                  dismiss.mutate({ slug });
                }
              }}
              size="sm"
              variant="ghost"
            >
              {waiting ? "Cancel" : "Not now"}
            </Button>
          </div>
        ) : kind === "key" ? (
          <div className="mt-3 flex items-center gap-2">
            <Input
              autoFocus
              className="h-8 flex-1 font-mono text-xs"
              onChange={(event) => {
                setValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && value.trim() !== "") {
                  setCredential.mutate({ slug, value: value.trim() });
                }
              }}
              placeholder="Paste the key"
              type="password"
              value={value}
            />
            <GlyphButton
              disabled={busy || value.trim() === ""}
              onClick={() => {
                setCredential.mutate({ slug, value: value.trim() });
              }}
              size="sm"
            >
              {setCredential.isPending ? "Checking…" : "Save"}
            </GlyphButton>
            <Button
              disabled={busy}
              onClick={() => {
                dismiss.mutate({ slug });
              }}
              size="sm"
              variant="ghost"
            >
              Not now
            </Button>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            Nothing to sign in to; Instrument is testing it.
          </p>
        )}
      </ToolCardSection>
    </ToolCard>
  );
}
