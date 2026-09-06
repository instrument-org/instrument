import { OrchestratorContext } from "@/client/components/orchestrator/context";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useContext, useState } from "react";
import { toast } from "sonner";

/** Where the sign-in page opens: the window's own browser, or the user's. */
type SignInDestination = "app" | "external";

/**
 * The one thing only the user can give an app, wherever it is asked for: a
 * sign-in, or a key. The card in the conversation, the directory row, and the
 * app's page all draw these same controls, so an app the agent set up gets
 * finished by a click on whichever of them is in front of the user, with no
 * second trip through the agent. Plain buttons, not the mark: nothing here
 * sends the agent a word.
 *
 * A sign-in opens the window's own browser, where the callback lands too and
 * the agent can see the page; the user's own browser is offered beside it,
 * since a session they already hold there may be the one they want. A key
 * goes straight to the encrypted store and is tested on arrival.
 */
export function ConnectControls({
  dismissible = false,
  kind,
  label,
  name,
  runs,
  slug,
}: {
  /** Whether "Not now" is offered: a card asks a question, a row does not. */
  dismissible?: boolean;
  kind: "key" | "run" | "sign-in";
  /** The sign-in button's words; the app's name is the default. */
  label?: string;
  name: string;
  /** For a local app, what would run on this machine, in words. */
  runs?: string;
  slug: string;
}) {
  const orchestrator = useContext(OrchestratorContext);
  const navigate = useNavigate();
  const openExternalLink = useOpenExternalLink();
  const [value, setValue] = useState("");
  const [waiting, setWaiting] = useState(false);

  const openAuthorization = (url: string, where: SignInDestination) => {
    if (where === "app" && orchestrator?.browser) {
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
    }),
  );
  const signIn = (where: SignInDestination) => {
    startOAuth.mutate(
      { opensIn: orchestrator?.browser ? where : "external", slug },
      {
        onSuccess: (result) => {
          if (result.status === "started") {
            setWaiting(true);
            openAuthorization(result.url, where);
          }
        },
      },
    );
  };
  const cancelOAuth = useMutation(
    rpcClient.apps.cancelOAuth.mutationOptions({
      onSuccess: () => {
        setWaiting(false);
      },
    }),
  );
  const dismiss = useMutation(rpcClient.apps.dismiss.mutationOptions());
  const allow = useMutation(
    rpcClient.apps.allow.mutationOptions({
      onError: (error) => {
        toast.error(`Could not start ${name}`, { description: error.message });
      },
      onSuccess: (report) => {
        const failure = report.checks.find((check) => check.status === "fail");
        if (failure) {
          toast.error(`${name} did not connect`, {
            description: failure.detail.split("\n")[0],
          });
        }
      },
    }),
  );
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
    allow.isPending ||
    startOAuth.isPending ||
    cancelOAuth.isPending ||
    dismiss.isPending ||
    setCredential.isPending;

  // A server that runs here is the one thing the user is agreeing to rather
  // than supplying, so the words say what will run before the button does it.
  if (kind === "run") {
    return (
      <div className="flex flex-col gap-2">
        {runs ? (
          <p className="text-xs text-muted-foreground">
            Instrument will install and run {runs} on this Mac.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              allow.mutate({ slug });
            }}
            size="sm"
          >
            {allow.isPending
              ? "Setting it up…"
              : (label ?? "Allow and connect")}
          </Button>
          {dismissible ? (
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
          ) : null}
        </div>
      </div>
    );
  }

  if (kind === "sign-in") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={busy || waiting}
          onClick={() => {
            signIn("app");
          }}
          size="sm"
        >
          {waiting
            ? "Waiting for the sign-in…"
            : (label ?? `Sign in to ${name}`)}
        </Button>
        {waiting ? null : (
          <Button
            disabled={busy}
            onClick={() => {
              signIn("external");
            }}
            size="sm"
            variant="ghost"
          >
            Use your own browser
          </Button>
        )}
        {dismissible || waiting ? (
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
        ) : null}
      </div>
    );
  }

  const save = () => {
    if (value.trim() !== "") {
      setCredential.mutate({ slug, value: value.trim() });
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        className="h-8 flex-1 font-mono text-xs"
        onChange={(event) => {
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            save();
          }
        }}
        placeholder={`Paste the ${name} key`}
        type="password"
        value={value}
      />
      <Button disabled={busy || value.trim() === ""} onClick={save} size="sm">
        {setCredential.isPending ? "Checking…" : "Save"}
      </Button>
      {dismissible ? (
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
      ) : null}
    </div>
  );
}
