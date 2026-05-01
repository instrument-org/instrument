import { InternalLink } from "@/client/components/internal-link";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { cn } from "@/client/lib/utils";
import { type Icon } from "@phosphor-icons/react";
import { type LinkProps } from "@tanstack/react-router";
import React from "react";

export function NavPrimary({
  items,
  ...props
}: React.ComponentPropsWithoutRef<typeof SidebarGroup> & {
  items: {
    badge?: React.ReactNode;
    icon: Icon;
    isActive?: boolean;
    isBrand?: boolean;
    isDeveloperMode?: boolean;
    title: string;
    url: LinkProps["to"];
  }[];
}) {
  return (
    <SidebarGroup {...props} className="pb-1 pl-1">
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem className="group" key={item.title}>
              <SidebarMenuButton
                asChild
                className={cn(
                  "group-hover:bg-black/10 data-[active=true]:bg-black/15 data-[active=true]:font-normal data-[active=true]:text-foreground dark:group-hover:bg-white/10 dark:data-[active=true]:bg-white/15",
                  item.isBrand &&
                    "font-bold data-[active=true]:bg-transparent data-[active=true]:text-brand-400",
                )}
                isActive={item.isBrand ? false : item.isActive}
              >
                <InternalLink
                  className={
                    item.isDeveloperMode
                      ? "text-blue-700 dark:text-blue-300 [&>svg]:size-4 [&>svg]:text-blue-700 dark:[&>svg]:text-blue-300"
                      : item.isBrand
                        ? "font-bold text-brand-400 [&>svg]:size-4 [&>svg]:text-brand-400"
                        : "[&>svg]:size-4"
                  }
                  openInCurrentTab
                  to={item.url}
                >
                  <item.icon />
                  <span>{item.title}</span>
                </InternalLink>
              </SidebarMenuButton>
              {item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
