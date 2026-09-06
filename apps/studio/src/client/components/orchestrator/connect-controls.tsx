import { OrchestratorContext } from "@/client/components/orchestrator/context";
import { GlyphButton } from "@/client/components/orchestrator/glyph-button";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Input } from "@/client/components/ui/input";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
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
 * second trip through the agent. A sign-in opens the window's own browser by
 * default, where the callback lands too and the agent can see the page; the
 * user's browser waits behind the chevron, since a session they already hold
 * there may be the one they want. A key goes straight to the encrypted store
 * and is tested on arrival.
 */
export function ConnectControls({
  dismissible = false,
  kind,
  label,
  name,
  size = "md",
  slug,
}: {
  /** Whether "Not now" is offered: a card asks a question, a row does not. */
  dismissible?: boolean;
  kind: "key" | "sign-in";
  /** The sign-in button's words; the app's name is the default. */
  label?: string;
  name: string;
  size?: "md" | "sm";
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
      { slug },
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
  const chevronHeight = size === "sm" ? "h-8" : "h-9";

  if (kind === "sign-in") {
    return (
      <div className="flex items-center gap-2">
        <span className="flex items-center">
          <GlyphButton
            className="rounded-r-none"
            disabled={busy || waiting}
            onClick={() => {
              signIn("app");
            }}
            size={size}
          >
            {waiting
              ? "Waiting for the sign-in…"
              : (label ?? `Sign in to ${name}`)}
          </GlyphButton>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Where to sign in"
                className={cn(
                  "flex items-center rounded-r-lg border border-l-0 border-border bg-card px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
                  chevronHeight,
                )}
                disabled={busy || waiting}
                type="button"
              >
                <CaretDownIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => {
                  signIn("external");
                }}
              >
                Sign in in your browser
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
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
      <GlyphButton
        disabled={busy || value.trim() === ""}
        onClick={save}
        size="sm"
      >
        {setCredential.isPending ? "Checking…" : "Save"}
      </GlyphButton>
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
