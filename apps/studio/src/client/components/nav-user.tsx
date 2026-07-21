import { openSettings } from "@/client/atoms/settings-modal";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";
import { SidebarMenu, SidebarMenuItem } from "@/client/components/ui/sidebar";
import { Skeleton } from "@/client/components/ui/skeleton";
import { getInitials } from "@/client/lib/get-initials";
import { rpcClient } from "@/client/rpc/client";
import { FadersHorizontalIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { useLiveSubscriptionStatus } from "../hooks/use-live-subscription-status";
import { useLiveUser } from "../hooks/use-live-user";

// Both variants share a height so the footer never resizes as auth, profile,
// and subscription resolve at different times and shove the rows above it.
const rowClassName =
  "flex h-19 w-full items-center gap-3 pr-5 pl-4 hover:bg-black/5 dark:hover:bg-white/5";

export function NavUser() {
  // Resolves from the main process without an API round trip, so it settles
  // before user.me and picks the right shape on the first paint.
  const { data: hasToken } = useQuery(
    rpcClient.auth.live.hasToken.experimental_liveOptions(),
  );
  const { data: user } = useLiveUser();
  const { data: subscription } = useLiveSubscriptionStatus();

  const planName = subscription?.plan ?? null;
  const isOutOfCredits = subscription && !subscription.hasEnoughCredits;

  if (hasToken === false) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <button
            className={`${rowClassName} text-gray-400 dark:text-gray-600`}
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
          className={rowClassName}
          onClick={() => {
            openSettings({ tab: "General" });
          }}
          type="button"
        >
          {user ? (
            <Avatar className="size-9 shrink-0 rounded-md">
              <AvatarImage alt={user.name} src={user.image ?? undefined} />
              <AvatarFallback className="rounded-md text-xs">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
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
