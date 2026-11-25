import { Button } from "@/client/components/ui/button";
import { ButtonGroup } from "@/client/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import { Spinner } from "@/client/components/ui/spinner";
import { type SignInDestination } from "@/client/components/window/use-sign-in-landing";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { FAILED_SIGN_IN_LABELS } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

const TRANSPARENT = new Set(["ghost", "outline"]);

/** The computer's default browser, by name and icon where it can say. */
function useDefaultBrowser() {
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
 * The one button a sign-in has. It says what it does in plain words, and the
 * caret's menu has each place it can be done, the first being where the
 * button itself goes; with one place there is no caret. While a sign-in waits
 * the button stays where it is, off, with Cancel before it. It belongs at the
 * end of its row, so Cancel coming up never moves it and a second press on it
 * lands on nothing.
 */
export function SignInButton({
  busy = false,
  canSignInHere,
  fix,
  first = "external",
  label = "Sign in",
  onCancel,
  onMenuOpen,
  onStart,
  size = "sm",
  variant = "outline",
  waiting,
}: {
  busy?: boolean;
  /** Whether the page can open in this window's own browser. */
  canSignInHere: boolean;
  /** Where the button itself goes. */
  first?: SignInDestination;
  /** Hands the sign-in to Instrument, from the menu where there is no room for a button of its own. */
  fix?: (() => void) | undefined;
  label?: string;
  onCancel: () => void;
  onMenuOpen?: () => void;
  onStart: (where: SignInDestination) => void;
  size?: "default" | "sm" | "xs";
  variant?: "brand" | "default" | "ghost" | "outline";
  waiting: boolean;
}) {
  const browser = useDefaultBrowser();
  const { appName, iconUrl } = browser.data ?? {};
  const off = busy || waiting;
  const ink = variant === "outline" ? "text-foreground" : undefined;
  const hasMenu = canSignInHere || fix !== undefined;
  const ways: Record<SignInDestination, ReactNode> = {
    app: (
      <DropdownMenuItem
        key="app"
        onSelect={() => {
          onStart("app");
        }}
      >
        <InstrumentGlyph className="size-4 shrink-0 text-brand-600 dark:text-brand-400" />
        Sign in here
      </DropdownMenuItem>
    ),
    external: (
      <DropdownMenuItem
        key="external"
        onSelect={() => {
          onStart("external");
        }}
      >
        {iconUrl ? (
          <img
            alt=""
            className="size-4 shrink-0"
            draggable={false}
            src={iconUrl}
          />
        ) : (
          <GlobeIcon className="size-4" />
        )}
        {/* Named only when the computer says which browser is the default. */}
        {`Sign in with ${appName ?? "your browser"}`}
      </DropdownMenuItem>
    ),
  };
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {waiting ? (
        <Button
          className="text-foreground"
          onClick={onCancel}
          size={size}
          variant={variant === "ghost" ? "ghost" : "outline"}
        >
          Cancel
        </Button>
      ) : null}
      <ButtonGroup>
        <Button
          className={ink}
          disabled={off}
          onClick={() => {
            onStart(canSignInHere ? first : "external");
          }}
          size={size}
          variant={variant}
        >
          {label}
        </Button>
        {hasMenu ? (
          <DropdownMenu
            onOpenChange={(open) => {
              if (open) {
                onMenuOpen?.();
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Other ways to sign in"
                className={cn(
                  ink,
                  "w-auto rounded-l-none px-2 has-[>svg]:px-2",
                  TRANSPARENT.has(variant)
                    ? "-ml-px"
                    : "border-l border-black/10 dark:border-white/15",
                  variant === "brand" && "border-white/25 dark:border-white/25",
                )}
                disabled={off}
                size={size}
                variant={variant}
              >
                <CaretDownIcon className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canSignInHere ? (
                <>
                  {ways[first]}
                  {ways[first === "app" ? "external" : "app"]}
                </>
              ) : (
                ways.external
              )}
              {fix ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={fix}>
                    {FAILED_SIGN_IN_LABELS.fix}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </ButtonGroup>
    </div>
  );
}

/** A line saying something is under way, its spinner ahead of the words. */
export function WaitingLine({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Spinner className="size-3 shrink-0" delay={0} />
      <span>{children}</span>
    </span>
  );
}

/** Where to finish a sign-in under way. */
export function SignInWaitingLine({ where }: { where: SignInDestination }) {
  const browser = useDefaultBrowser();
  return (
    <WaitingLine>
      {where === "external"
        ? `Finish signing in with ${browser.data?.appName ?? "your browser"}`
        : "Finish signing in on the page that opened"}
    </WaitingLine>
  );
}
