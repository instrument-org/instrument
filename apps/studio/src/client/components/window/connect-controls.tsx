import { BrowserHandoffButton } from "@/client/components/browser-handoff-button";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { osConventions } from "@/client/lib/utils";
import { WindowContext } from "@/client/components/window/context";
import {
  type SignInDestination,
  signInsWaitingAtom,
} from "@/client/components/window/use-sign-in-landing";
import { useOpenExternalLink } from "@/client/hooks/use-open-external-link";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { type ReactNode, useContext, useState } from "react";
import { toast } from "@/client/lib/toast";

/** The computer's default browser, by name and icon where it can say. */
export function useDefaultBrowser() {
  return useQuery(
    rpcClient.utils.browserOpenTarget.queryOptions({
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
}

/**
 * The one thing only the user can give an app, wherever it is asked for: a
 * sign-in, or a key. The card in the conversation, the directory row, and the
 * app's page all draw these same controls, so an app the agent set up gets
 * finished by a click on whichever of them is in front of the user, with no
 * second trip through the agent. Plain buttons, not the mark: nothing here
 * sends the agent a word.
 *
 * A sign-in leads with the user's own browser, where they are most likely
 * already signed in and have their passkeys, saved passwords and extensions;
 * the window's own browser is offered beside it. Either one connects the app,
 * since the answer comes back to the same callback. A key
 * goes straight to the encrypted store and is tested on arrival. A web app
 * signs in on its own site in the window's browser, and the user's word that
 * they did is what connects it.
 */
export function ConnectControls({
  alongside,
  askedIn,
  compact = false,
  describesDestination = true,
  kind,
  label,
  name,
  onOpened,
  opened = false,
  runs,
  slug,
}: {
  /** One more control at the end of the row: the app's page puts its way to ask the agent here. */
  alongside?: ReactNode;
  /** For a card in a chat, the chat, which hears what the user does here even after the card stopped waiting. */
  askedIn?: ChatId;
  /**
   * For a row of the card in a chat, the buttons that fit in the row: a
   * sign-in's two, or a web app's one. `primary` lights the first as the one
   * to press next. `failure` is how the app's last sign-in ended: another try
   * is offered in the user's own browser beside the app's site, since the
   * site is the one way in that is really different, and a refusal leaves only
   * the site, since the same sign-in meets the same refusal. `hasSite` is
   * whether there is one: an app on this machine has none, so its other way
   * is the same sign-in here, and a refusal leaves nothing to press.
   */
  compact?:
    | { failure?: "failed" | "refused"; hasSite: boolean; primary: boolean }
    | false;
  /** Whether a sign-in says where it signs in; off where a line above already explains the buttons. */
  describesDestination?: boolean;
  kind: "key" | "run" | "sign-in" | "web";
  /** The button's words, where they differ from what it does by default. */
  label?: string;
  name: string;
  /** For a compact row, that it sent the user to the app's site, so its next step is the word that the sign-in there is done. */
  onOpened?: () => void;
  /** For a web app, whether its site was already opened, so the controls ask for the word that the sign-in is done. */
  opened?: boolean;
  /** For a local app, what would run on this machine, in words. */
  runs?: string;
  slug: string;
}) {
  const appWindow = useContext(WindowContext);
  const inChat = askedIn === undefined ? {} : { chatId: askedIn };
  const openExternalLink = useOpenExternalLink();
  const [value, setValue] = useState("");
  // Whether a web app's site has been opened from here, after which the
  // controls ask for the word that the sign-in there is done.
  const [openedSite, setOpenedSite] = useState(opened);
  // The default browser, for the button that sends the sign-in there.
  const browser = useDefaultBrowser();
  // Whether a sign-in started here is still waiting, kept by the window
  // so it outlives these controls (see `useSignInLanding`).
  const [signInsWaiting, setSignInsWaiting] = useAtom(signInsWaitingAtom);
  const waiting = signInsWaiting.has(slug);
  const setWaiting = (
    started: { from: number | undefined; where: SignInDestination } | false,
  ) => {
    setSignInsWaiting((current) => {
      const next = new Map(current);
      if (started) {
        next.set(slug, { ...started, inChat: appWindow?.chatId !== undefined });
      } else {
        next.delete(slug);
      }
      return next;
    });
  };
  const apps = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const listed = apps.data?.apps.find((app) => app.slug === slug);
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
        toast.error("Couldn't start signing in", { cause: error });
      },
    }),
  );
  const signIn = (where: SignInDestination) => {
    if (origin === undefined) {
      return;
    }
    const opensIn = appWindow?.browser ? where : "external";
    startOAuth.mutate(
      {
        ...inChat,
        opensIn,
        origin,
        slug,
      },
      {
        onSuccess: (result) => {
          if (result.status === "started") {
            setWaiting({ from: listed?.connection?.updatedAt, where: opensIn });
            openAuthorization(result.url, where);
          }
        },
      },
    );
  };
  const cancelOAuth = useMutation(rpcClient.apps.cancelOAuth.mutationOptions());
  const markWebSignedIn = useMutation(
    rpcClient.apps.markWebSignedIn.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't connect ${name}`, { cause: error });
      },
    }),
  );
  const allow = useMutation(
    rpcClient.apps.allow.mutationOptions({
      onError: (error) => {
        toast.error(`Couldn't start ${name}`, { cause: error });
      },
      onSuccess: (report) => {
        const failure = report.checks.find((check) => check.status === "fail");
        if (failure) {
          toast.error(`Couldn't connect ${name}`, { cause: failure.detail });
        }
      },
    }),
  );
  const setCredential = useMutation(
    rpcClient.apps.setCredential.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't save the key", { cause: error });
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
    markWebSignedIn.isPending ||
    setCredential.isPending;

  // A server that runs here is the one thing the user is agreeing to rather
  // than supplying, so the words say what will run before the button does it.
  if (kind === "run") {
    return (
      <div className="flex flex-col gap-2">
        {runs ? (
          <p className="text-xs text-muted-foreground">
            Instrument will install and run {runs} on{" "}
            {osConventions().thisComputer}.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy}
            onClick={() => {
              allow.mutate({ ...inChat, slug });
            }}
            size="sm"
          >
            {allow.isPending
              ? "Setting it up…"
              : (label ?? "Allow and connect")}
          </Button>
          {alongside}
        </div>
      </div>
    );
  }

  // A site's own sign-in, in the window's browser where the work happens:
  // nothing here can see the session, so once the site is open the user says
  // when they are done there.
  if (kind === "web") {
    const signInPage = listed?.type === "web" ? listed.signIn : undefined;
    const openSite = () => {
      if (signInPage !== undefined) {
        appWindow?.openPage(signInPage);
        setOpenedSite(true);
      }
    };
    if (compact) {
      return (
        <Button
          className={compact.primary ? undefined : "text-foreground"}
          disabled={busy || !appWindow?.browser || signInPage === undefined}
          onClick={() => {
            openSite();
            onOpened?.();
          }}
          size="sm"
          variant={compact.primary ? "brand" : "outline"}
        >
          Sign in here
        </Button>
      );
    }
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
                  markWebSignedIn.mutate({ ...inChat, slug });
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
          {alongside}
        </div>
      </div>
    );
  }

  // Named only when the computer says which browser is the default, so the
  // button never promises the wrong one.
  const ownBrowser = (verb: string) =>
    browser.data?.appName ? (
      <>
        {browser.data.iconUrl ? (
          <img
            alt=""
            className="size-4 shrink-0"
            draggable={false}
            src={browser.data.iconUrl}
          />
        ) : null}
        {`${verb} with ${browser.data.appName}`}
      </>
    ) : (
      `${verb} with your browser`
    );
  const cancelSignIn = () => {
    setWaiting(false);
    cancelOAuth.mutate({ slug });
  };

  if (kind === "sign-in" && compact) {
    const { failure, hasSite, primary } = compact;
    const onSite = (lit: boolean) => (
      <SignInOnSiteButton lit={lit} onOpened={onOpened} slug={slug} />
    );
    if (failure === "refused") {
      return hasSite ? onSite(primary) : null;
    }
    return (
      <div className="flex shrink-0 items-center gap-1.5 @max-md/transcript:w-full @max-md/transcript:flex-wrap @max-md/transcript:*:flex-1">
        <BrowserHandoffButton
          className={primary ? undefined : "text-foreground"}
          disabled={busy}
          onCancel={cancelSignIn}
          onStart={() => {
            signIn("external");
          }}
          size="sm"
          variant={primary ? "brand" : "outline"}
          waiting={waiting}
        >
          {ownBrowser(failure === "failed" ? "Try again" : "Sign in")}
        </BrowserHandoffButton>
        {waiting ? null : failure === "failed" && hasSite ? (
          onSite(false)
        ) : (
          <Button
            className="text-foreground"
            disabled={busy}
            onClick={() => {
              signIn("app");
            }}
            size="sm"
            variant="outline"
          >
            Sign in here
          </Button>
        )}
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
            onCancel={cancelSignIn}
            onStart={() => {
              signIn("external");
            }}
            size="sm"
            variant="brand"
            waiting={waiting}
          >
            {ownBrowser("Sign in")}
          </BrowserHandoffButton>
          {waiting ? null : (
            <Button
              className="text-foreground"
              disabled={busy}
              onClick={() => {
                signIn("app");
              }}
              size="sm"
              variant="outline"
            >
              {label ?? "Sign in here"}
            </Button>
          )}
          {alongside}
        </div>
      </div>
    );
  }

  const save = () => {
    if (value.trim() !== "" && origin !== undefined) {
      setCredential.mutate({ ...inChat, origin, slug, value: value.trim() });
    }
  };
  // Where the directory says the key is made, so the card says where to go
  // rather than asking for something the user has never seen.
  const keyHelp = listed?.type === "web" ? undefined : listed?.keyHelp;
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
      </div>
      {alongside ? (
        <div className="flex flex-wrap gap-2">{alongside}</div>
      ) : null}
    </div>
  );
}

/**
 * Moves the app to the service's site and opens it in the window's browser,
 * where the site's own sign-in works and its cookies keep it.
 */
function SignInOnSiteButton({
  lit,
  onOpened,
  slug,
}: {
  lit: boolean;
  onOpened: (() => void) | undefined;
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
        onOpened?.();
      },
    }),
  );
  return (
    <Button
      className={lit ? undefined : "text-foreground"}
      disabled={move.isPending || !appWindow?.browser}
      onClick={() => {
        move.mutate({ slug });
      }}
      size="sm"
      variant={lit ? "brand" : "outline"}
    >
      Sign in here
    </Button>
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
