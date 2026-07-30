import { openSettings } from "@/client/atoms/settings-modal";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";
import { SidebarMenu, SidebarMenuItem } from "@/client/components/ui/sidebar";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getInitials } from "@/client/lib/get-initials";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { FadersHorizontalIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { useLiveSubscriptionStatus } from "../hooks/use-live-subscription-status";
import { useLiveUser } from "../hooks/use-live-user";

const rowClassName =
  "flex w-full items-center gap-3 pr-5 pl-4 hover:bg-black/5 dark:hover:bg-white/5";

export function NavUser() {
  // Resolves from the main process without an API round trip, so it settles
  // before user.me and picks the right shape on the first paint.
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: user, error: userError } = useLiveUser();
  const { data: subscription, error: subscriptionError } =
    useLiveSubscriptionStatus();

  const planName = subscription?.plan ?? null;
  const isOutOfCredits = subscription && !subscription.hasEnoughCredits;

  // A failed refetch (offline, API blip) keeps the last good data, so only
  // swap in the error copy once there is nothing left to show. Settings
  // holds the real handling: the row just links there.
  const isUserUnreachable = Boolean(userError) && !user;
  const isPlanUnreachable = Boolean(subscriptionError) && !subscription;

  if (hasToken === false) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <button
            className={cn(
              rowClassName,
              "h-15 text-gray-400 dark:text-gray-600",
            )}
            onClick={() => {
              openSettings({ tab: "General" });
            }}
            type="button"
          >
            <FadersHorizontalIcon className="size-4 shrink-0" />
            <span className="text-sm font-medium">Settings</span>
          </button>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <button
          // Fixed so the row keeps one height as profile and subscription
          // resolve at different times rather than shoving the rows above it.
          className={cn(rowClassName, "h-19")}
          onClick={() => {
            openSettings({ tab: "General" });
          }}
          title={userError?.message ?? subscriptionError?.message}
          type="button"
        >
          {user ? (
            <Avatar className="size-9 shrink-0 rounded-md">
              <AvatarImage alt={user.name} src={user.image ?? undefined} />
              <AvatarFallback className="rounded-md text-xs">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
          ) : isUserUnreachable ? (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <WarningCircleIcon className="size-4" />
            </div>
          ) : (
            <Skeleton className="size-9 shrink-0 rounded-md" />
          )}
          {/* The gear top-aligns against the name/plan block, not the padded
              row, so it needs to share a container with just those lines. */}
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="grid min-w-0 flex-1 text-left">
              {user ? (
                <span className="truncate text-sm/5 font-medium">
                  {user.name}
                </span>
              ) : isUserUnreachable ? (
                <span className="truncate text-sm/5 font-medium text-muted-foreground">
                  Not connected
                </span>
              ) : (
                <Skeleton className="my-0.5 h-4 w-24" />
              )}
              {subscription ? (
                isOutOfCredits ? (
                  <span className="truncate text-[10px]/4.5 tracking-wide text-muted-foreground/70 uppercase">
                    No credits
                  </span>
                ) : (
                  <span className="truncate text-xs/4.5 text-muted-foreground">
                    {planName ?? "Free"}
                  </span>
                )
              ) : isUserUnreachable || isPlanUnreachable ? (
                <span className="truncate text-xs/4.5 text-muted-foreground/70">
                  {isUserUnreachable
                    ? "Account unavailable"
                    : "Plan unavailable"}
                </span>
              ) : (
                <Skeleton className="my-0.5 h-3.5 w-12" />
              )}
            </div>
            <FadersHorizontalIcon className="size-4 shrink-0 text-gray-400 dark:text-gray-600" />
          </div>
        </button>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
