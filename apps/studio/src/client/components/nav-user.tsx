import { FoundingUserLabel } from "@/client/components/founding-user-label";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/client/components/ui/avatar";
import { Button } from "@/client/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/client/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { useHasLifetime } from "@/client/hooks/use-entitlements";
import { useTabActions } from "@/client/hooks/use-tab-actions";
import { captureClientEvent } from "@/client/lib/capture-client-event";
import { getInitials } from "@/client/lib/get-initials";
import { isLowOnCredits } from "@/client/lib/is-low-on-credits";
import { openSettings } from "@/client/lib/studio-overlay";
import { CaretDownIcon, GearIcon } from "@phosphor-icons/react";
import { startTransition } from "react";

import { useLiveSubscriptionStatus } from "../hooks/use-live-subscription-status";
import { useLiveUser } from "../hooks/use-live-user";

export function NavUser() {
  const { addTab } = useTabActions();
  const { data: user, refetch: refetchUser } = useLiveUser();
  const { data: subscription, refetch: refetchSubscription } =
    useLiveSubscriptionStatus();

  const hasLifetime = useHasLifetime();
  const planName = subscription?.plan ?? null;

  const onUpgrade = () => {
    captureClientEvent("upgrade.clicked", {
      source: "nav_user",
    });
    void addTab({ to: "/get-lifetime" });
  };

  const isOutOfCredits = subscription && !subscription.hasEnoughCredits;

  if (!user) {
    return (
      <SidebarMenu>
        <SidebarMenuItem className="group">
          <SidebarMenuButton
            className="h-auto! gap-3 rounded-none! py-4 pr-5 pl-4 group-hover:bg-black/10 dark:group-hover:bg-white/10"
            onClick={() => {
              openSettings({ tab: "General" });
            }}
            size="lg"
          >
            <GearIcon className="size-5" />
            <div className="grid flex-1 text-left text-sm/tight">
              <span className="truncate font-medium">Settings</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem className="group">
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) {
              startTransition(() => {
                void refetchUser();
                void refetchSubscription();
              });
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              className="h-auto! items-start! gap-3 rounded-none! py-4 pr-5 pl-4 group-hover:bg-black/10 data-[state=open]:bg-black/10 dark:group-hover:bg-white/10 dark:data-[state=open]:bg-white/10"
              size="lg"
            >
              <Avatar className="size-8 rounded-lg">
                <AvatarImage alt={user.name} src={user.image ?? undefined} />
                <AvatarFallback className="rounded-lg">
                  {getInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm/tight">
                <span className="truncate font-medium">{user.name}</span>
                {subscription &&
                  (isOutOfCredits ? (
                    <span className="truncate text-[10px] tracking-wide text-muted-foreground/70 uppercase">
                      No credits
                    </span>
                  ) : hasLifetime ? (
                    <FoundingUserLabel className="truncate" />
                  ) : (
                    <span className="truncate text-xs text-muted-foreground">
                      {planName ?? "Free"}
                    </span>
                  ))}
              </div>
              <CaretDownIcon
                className="mt-1 ml-auto size-3.5! self-start"
                weight="regular"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-58 rounded-lg"
            side="top"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="size-8 rounded-lg">
                  <AvatarImage alt={user.name} src={user.image ?? undefined} />
                  <AvatarFallback className="rounded-lg">
                    {getInitials(user.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm/tight">
                  <span className="truncate font-medium">{user.name}</span>
                  {subscription &&
                    (hasLifetime ? (
                      <FoundingUserLabel className="truncate" />
                    ) : (
                      <span className="truncate text-xs">
                        {planName ?? "Free"}
                      </span>
                    ))}
                </div>
              </div>
            </DropdownMenuLabel>
            {subscription && isLowOnCredits(subscription) && (
              <>
                <div className="px-2 py-1.5">
                  <Button
                    className="h-7 w-full text-xs font-semibold"
                    onClick={onUpgrade}
                    size="sm"
                    variant="brand"
                  >
                    Get more credits
                  </Button>
                </div>
                <DropdownMenuSeparator />
              </>
            )}
            {subscription && !isLowOnCredits(subscription) && (
              <DropdownMenuSeparator />
            )}

            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={() => {
                  openSettings({ tab: "General" });
                }}
              >
                <GearIcon className="size-4" />
                <span>Settings</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
