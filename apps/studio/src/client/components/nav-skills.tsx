import { InternalLink } from "@/client/components/internal-link";
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/client/components/ui/sidebar";
import { GraduationCapIcon } from "@phosphor-icons/react";
import { type MakeRouteMatchUnion } from "@tanstack/react-router";

export function NavSkills({ matches }: { matches: MakeRouteMatchUnion[] }) {
  const isActive = matches.some(
    (match) =>
      match.routeId === "/_app/skills/" ||
      match.routeId === "/_app/skills/$name",
  );

  return (
    <SidebarGroup className="px-3 pt-1 pb-0 group-data-[collapsible=icon]:hidden">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            className="h-9 gap-2 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground data-[active=true]:text-sidebar-foreground"
            isActive={isActive}
          >
            <InternalLink openInCurrentTab to="/skills">
              <GraduationCapIcon className="size-4 shrink-0 text-gray-400 [[data-active=true]_&]:text-sidebar-foreground" />
              <span className="font-medium">Skills</span>
            </InternalLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
