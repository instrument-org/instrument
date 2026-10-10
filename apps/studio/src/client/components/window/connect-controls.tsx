import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { thisComputer } from "@/client/components/window/computer-name";
import { WindowContext } from "@/client/components/window/context";
import { signInsWaitingAtom } from "@/client/components/window/use-sign-in-landing";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { type ReactNode, useContext, useState } from "react";
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
 * goes straight to the encrypted store and is tested on arrival. A web app
 * signs in on its own site in the window's browser, and the user's word that
 * they did is what connects it.
 */
export function ConnectControls({
  alongside,
  describesDestination = true,
  dismissible = false,
  kind,
  label,
  name,
  runs,
  slug,
}: {
  /** One more control at the end of the row: the app's page puts its way to ask the agent here. */
  alongside?: ReactNode;
  /** Whether a sign-in says where it signs in; off where a line above already explains the buttons. */
  describesDestination?: boolean;
  /** Whether "Not now" is offered: a card asks a question, a row does not. */
  dismissible?: boolean;
  kind: "key" | "run" | "sign-in" | "web";
  /** The sign-in button's words; the app's name is the default. */
  label?: string;
  name: string;
  /** For a local app, what would run on this machine, in words. */
  runs?: string;
  slug: string;
}) {
  const appWindow = useContext(WindowContext);
  const openExternalLink = useOpenExternalLink();
  const [value, setValue] = useState("");
  // Whether a web app's site has been opened from here, after which the
  // controls ask for the word that the sign-in there is done.
  const [openedSite, setOpenedSite] = useState(false);
  // The default browser, for the button that sends the sign-in there.
  const browser = useQuery(
    rpcClient.utils.browserOpenTarget.queryOptions({
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  // Whether a sign-in started here is still waiting, kept by the window
  // so it outlives these controls (see `useSignInLanding`).
  const [signInsWaiting, setSignInsWaiting] = useAtom(signInsWaitingAtom);
  const waiting = signInsWaiting.has(slug);
  const setWaiting = (isWaiting: boolean, from?: string) => {
    setSignInsWaiting((current) => {
      const next = new Map(current);
      if (isWaiting) {
        next.set(slug, from);
      } else {
        next.delete(slug);
      }
      return next;
    });
  };
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const listed = apps.data?.apps.find((app) => app.slug === slug);
  const standing = listed?.standing;
  // Where a key or sign-in given here goes. It is shown, and sent back with
  // the key or the sign-in, so main refuses if the app was pointed elsewhere
  // after the user read it.
  const origin = listed?.credentialOrigin;
  const openAuthorization = (url: string, where: SignInDestination) => {
    if (where === "app" && appWindow?.browser) {
      appWindow.openPage(url);
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
    if (origin === undefined) {
      return;
    }
    startOAuth.mutate(
      { opensIn: appWindow?.browser ? where : "external", origin, slug },
      {
        onSuccess: (result) => {
          if (result.status === "started") {
            setWaiting(true, standing);
            openAuthorization(result.url, where);
          }
        },
      },
    );
  };
  const cancelOAuth = useMutation(rpcClient.apps.cancelOAuth.mutationOptions());
  const dismiss = useMutation(rpcClient.apps.dismiss.mutationOptions());
  const markWebSignedIn = useMutation(
    rpcClient.apps.markWebSignedIn.mutationOptions({
      onError: (error) => {
        toast.error(`Could not connect ${name}`, {
          description: error.message,
        });
      },
    }),
  );
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
    origin === undefined ||
    allow.isPending ||
    startOAuth.isPending ||
    cancelOAuth.isPending ||
    dismiss.isPending ||
    markWebSignedIn.isPending ||
    setCredential.isPending;

  // A server that runs here is the one thing the user is agreeing to rather
  // than supplying, so the words say what will run before the button does it.
  if (kind === "run") {
    return (
      <div className="flex flex-col gap-2">
        {runs ? (
          <p className="text-xs text-muted-foreground">
            Instrument will install and run {runs} on {thisComputer()}.
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
          {alongside}
        </div>
      </div>
    );
  }

  // A site's own sign-in, in the window's browser where the work happens:
  // nothing here can see the session, so once the site is open the user says
  // when they are done there.
  if (kind === "web") {
    const signInPage = listed?.signIn;
    const openSite = () => {
      if (signInPage !== undefined) {
        appWindow?.openPage(signInPage);
        setOpenedSite(true);
      }
    };
    return (
      <div className="flex flex-col gap-2">
        {openedSite ? (
          <p className="text-xs text-muted-foreground">
            Sign in on the {name} page that opened, then press Done.
          </p>
        ) : (
          <Destination origin={origin}>Signs in at</Destination>
        )}
        <div className="flex flex-wrap items-center gap-2 @max-md/transcript:flex-col @max-md/transcript:items-stretch">
          {openedSite ? (
            <>
              <Button
                disabled={busy}
                onClick={() => {
                  markWebSignedIn.mutate({ slug });
                }}
                size="sm"
              >
                Done signing in
              </Button>
              <Button
                disabled={busy || !appWindow?.browser}
                onClick={openSite}
                size="sm"
                variant="outline"
              >
                {`Open ${name} again`}
              </Button>
            </>
          ) : (
            <Button
              disabled={busy || !appWindow?.browser || signInPage === undefined}
              onClick={openSite}
              size="sm"
            >
              {label ?? `Open ${name}`}
            </Button>
          )}
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
          {alongside}
        </div>
      </div>
    );
  }

  if (kind === "sign-in") {
    return (
      <div className="flex flex-col gap-2">
        {describesDestination ? (
          <Destination origin={origin}>Signs in at</Destination>
        ) : null}
        {/* In a column too narrow for three buttons in a row they stack, each
          the column's width, rather than wrapping into a ragged pair. */}
        <div className="flex flex-wrap items-center gap-2 @max-md/transcript:flex-col @max-md/transcript:items-stretch">
          <BrowserHandoffButton
            disabled={busy}
            onCancel={() => {
              setWaiting(false);
              cancelOAuth.mutate({ slug });
            }}
            onStart={() => {
              signIn("app");
            }}
            size="sm"
            waiting={waiting}
          >
            {label ?? "Sign in here"}
          </BrowserHandoffButton>
          {waiting ? null : (
            <Button
              disabled={busy}
              onClick={() => {
                signIn("external");
              }}
              size="sm"
              variant="outline"
            >
              {/* Named only when the computer says which browser is the
                  default, so the button never promises the wrong one. */}
              {browser.data?.appName ? (
                <>
                  {browser.data.iconUrl ? (
                    <img
                      alt=""
                      className="size-4 shrink-0"
                      draggable={false}
                      src={browser.data.iconUrl}
                    />
                  ) : null}
                  {`Sign in with ${browser.data.appName}`}
                </>
              ) : (
                "Sign in with your browser"
              )}
            </Button>
          )}
          {dismissible && !waiting ? (
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
          {alongside}
        </div>
      </div>
    );
  }

  const save = () => {
    if (value.trim() !== "" && origin !== undefined) {
      setCredential.mutate({ origin, slug, value: value.trim() });
    }
  };
  // Where the directory says the key is made, so the card says where to go
  // rather than asking for something the user has never seen.
  const keyHelp = listed?.keyHelp;
  return (
    <div className="flex flex-col gap-2">
      {keyHelp ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {keyHelp.steps ?? `Make a key for ${name}, then paste it here.`}
          </p>
          <Button
            onClick={() => {
              if (appWindow?.browser) {
                appWindow.openPage(keyHelp.page);
              } else {
                openExternalLink(keyHelp.page, { addReferral: false });
              }
            }}
            size="sm"
            variant="outline"
          >
            Get a key
          </Button>
        </div>
      ) : null}
      <Destination origin={origin}>The key goes only to</Destination>
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
      {alongside ? (
        <div className="flex flex-wrap gap-2">{alongside}</div>
      ) : null}
    </div>
  );
}

/** The host a key or sign-in goes to, in the words that lead into it. */
function Destination({
  children,
  origin,
}: {
  children: string;
  origin: string | undefined;
}) {
  if (origin === undefined) {
    return null;
  }
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {
    // Not a URL: shown as it is.
  }
  return (
    <p className="text-xs text-muted-foreground">
      {children} <span className="font-medium text-foreground">{host}</span>.
    </p>
  );
}
