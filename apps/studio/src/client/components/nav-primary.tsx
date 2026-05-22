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
    title: string;
    url: LinkProps["to"];
  }[];
}) {
  return (
    <SidebarGroup {...props} className="px-3 pb-1">
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem className="group" key={item.title}>
              <SidebarMenuButton
                asChild
                className={cn(
                  "group-hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:font-normal data-[active=true]:text-foreground",
                  item.isBrand &&
                    "font-medium data-[active=true]:bg-transparent data-[active=true]:text-brand-400",
                )}
                isActive={item.isBrand ? false : item.isActive}
              >
                <InternalLink
                  className={
                    item.isBrand
                      ? "font-medium text-brand-400 [&>svg]:size-4 [&>svg]:text-brand-400"
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
