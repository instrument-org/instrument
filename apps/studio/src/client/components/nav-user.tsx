import { Avatar, AvatarFallback, AvatarImage } from "@/client/components/ui/avatar";
import { SidebarMenu, SidebarMenuItem } from "@/client/components/ui/sidebar";
import { getInitials } from "@/client/lib/get-initials";
import { rpcClient } from "@/client/rpc/client";
import { FadersHorizontalIcon } from "@phosphor-icons/react";

import { useLiveSubscriptionStatus } from "../hooks/use-live-subscription-status";
import { useLiveUser } from "../hooks/use-live-user";

export function NavUser() {
  const { data: user } = useLiveUser();
  const { data: subscription } = useLiveSubscriptionStatus();

  const planName = subscription?.plan ?? null;
  const isOutOfCredits = subscription && !subscription.hasEnoughCredits;

  if (!user) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <button
            className="flex w-full items-center gap-3 py-5 pr-5 pl-4 text-gray-400 hover:bg-black/5 dark:text-gray-600 dark:hover:bg-white/5"
            onClick={() => {
              void rpcClient.studioOverlay.show.call({
                kind: "settings",
                props: { tab: "General" },
              });
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
          className="flex w-full items-start gap-3 py-5 pr-5 pl-4 hover:bg-black/5 dark:hover:bg-white/5"
          onClick={() => {
            void rpcClient.studioOverlay.show.call({
              kind: "settings",
              props: { tab: "General" },
            });
          }}
          type="button"
        >
          <Avatar className="size-7 shrink-0 rounded-md">
            <AvatarImage alt={user.name} src={user.image ?? undefined} />
            <AvatarFallback className="rounded-md text-xs">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 flex-1 text-left text-sm/tight">
            <span className="truncate font-medium">{user.name}</span>
            {subscription &&
              (isOutOfCredits ? (
                <span className="truncate text-[10px] tracking-wide text-muted-foreground/70 uppercase">
                  No credits
                </span>
              ) : (
                <span className="truncate text-xs text-muted-foreground">
                  {planName ?? "Free"}
                </span>
              ))}
          </div>
          <FadersHorizontalIcon className="size-4 shrink-0 text-gray-400 dark:text-gray-600" />
        </button>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
