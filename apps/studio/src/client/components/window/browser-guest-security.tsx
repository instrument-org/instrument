import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Label } from "@/client/components/ui/label";
import { rpcClient } from "@/client/rpc/client";
import { type GuestSignIn } from "@/shared/browser";
import { type BrowserTargetId } from "@instrument-org/workspace/client";
import { WarningIcon } from "@phosphor-icons/react/Warning";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

/** The oldest sign-in a tab's page is waiting on, or null. */
export function useGuestSignIn(
  targetId: BrowserTargetId | null,
): GuestSignIn | null {
  const { data } = useQuery(
    rpcClient.browser.live.signIns.experimental_liveOptions(),
  );
  return data?.find((signIn) => signIn.targetId === targetId) ?? null;
}

/**
 * What a site asking for a username and password puts over its tab, the way
 * a browser's own sign-in sheet does. What is typed goes to the page's
 * request and nowhere else.
 */
export function SignInSheet({ signIn }: { signIn: GuestSignIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const { isPending, mutate } = useMutation(
    rpcClient.browser.answerSignIn.mutationOptions(),
  );
  const ids = useId();
  const cancel = () => {
    mutate({ credentials: null, id: signIn.id });
  };
  return (
    <div className="absolute inset-0 flex items-start justify-center bg-card p-6 pt-[12%]">
      <form
        className="w-full max-w-sm space-y-4 rounded-xl border bg-popover p-5 shadow-float-lg"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
        onSubmit={(event) => {
          event.preventDefault();
          mutate({ credentials: { password, username }, id: signIn.id });
        }}
      >
        <div className="space-y-1">
          <p className="font-medium break-words">
            {signIn.proxy
              ? `Sign in to the proxy at ${signIn.site}`
              : `Sign in to ${signIn.site}`}
          </p>
          {!signIn.secure && (
            <p className="text-sm text-muted-foreground">
              Your connection to this site isn’t private, so someone could see
              what you type.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-username`}>Username</Label>
          <Input
            autoComplete="username"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- the sheet is the one thing asked of the person
            autoFocus
            id={`${ids}-username`}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            spellCheck={false}
            value={username}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${ids}-password`}>Password</Label>
          <Input
            autoComplete="current-password"
            id={`${ids}-password`}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            type="password"
            value={password}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button
            disabled={isPending}
            onClick={cancel}
            size="sm"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={isPending} size="sm" type="submit">
            Sign in
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Why a certificate was refused, from the error Chromium names it by. */
function certificateProblemOf(error: string): string {
  if (error.includes("DATE_INVALID")) {
    return "Its security certificate has expired or isn’t valid yet.";
  }
  if (error.includes("AUTHORITY_INVALID")) {
    return "Your computer doesn’t trust whoever issued its security certificate.";
  }
  if (error.includes("COMMON_NAME_INVALID")) {
    return "Its security certificate is for a different site.";
  }
  if (error.includes("REVOKED")) {
    return "Its security certificate was canceled by whoever issued it.";
  }
  return "Something is wrong with its security certificate.";
}

/**
 * What a tab shows in place of a page whose certificate was refused, the
 * way a browser warns before it: why, a way back, and behind Advanced, a
 * way through for someone who knows the site. Continuing trusts that
 * certificate for the site until the app quits.
 */
export function CertificateErrorNotice({
  error,
  onGoBack,
  targetId,
  url,
}: {
  /** The refusal as Chromium names it, `ERR_CERT_DATE_INVALID`. */
  error: string;
  onGoBack: () => void;
  targetId: BrowserTargetId;
  url: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const host = URL.parse(url)?.host ?? url;
  const { data, isPending, mutate } = useMutation(
    rpcClient.browser.continueDespiteCertificate.mutationOptions(),
  );
  return (
    <div className="absolute inset-0 overflow-y-auto bg-card p-6">
      <div className="mx-auto mt-[10%] max-w-lg space-y-4 text-sm">
        <WarningIcon className="size-10 text-destructive" />
        <h2 className="text-xl font-semibold">Your connection isn’t private</h2>
        <p className="text-muted-foreground">
          Someone might be pretending to be{" "}
          <span className="font-medium text-foreground">{host}</span> to steal
          what you send it, like passwords, messages, or card numbers.
        </p>
        <p className="font-mono text-xs text-muted-foreground">
          NET::{error.replace(/^net::/, "")}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button onClick={onGoBack} size="sm">
            Go back
          </Button>
          <Button
            aria-expanded={advanced}
            onClick={() => {
              setAdvanced((open) => !open);
            }}
            size="sm"
            variant="ghost"
          >
            {advanced ? "Hide advanced" : "Advanced"}
          </Button>
        </div>
        {advanced && (
          <div className="space-y-3 border-t pt-4 text-muted-foreground">
            <p>
              Instrument can’t confirm this is really {host}.{" "}
              {certificateProblemOf(error)}
            </p>
            <Button
              className="h-auto p-0 text-destructive"
              disabled={isPending}
              onClick={() => {
                mutate({ targetId, url });
              }}
              variant="link"
            >
              Continue to {host} (unsafe)
            </Button>
            {data?.continued === false && <p>Reload the page and try again.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
