import { Card } from "@/client/components/ui/card";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/debug/colors")({
  component: RouteComponent,
});

function RouteComponent() {
  const colors = [
    { class: "bg-background", name: "background" },
    { class: "bg-foreground", name: "foreground" },
    { class: "bg-primary", name: "primary" },
    { class: "bg-primary-foreground", name: "primary-foreground" },
    { class: "bg-secondary", name: "secondary" },
    { class: "bg-secondary-foreground", name: "secondary-foreground" },
    { class: "bg-brand-25", name: "brand-25" },
    { class: "bg-brand-50", name: "brand-50" },
    { class: "bg-brand-100", name: "brand-100" },
    { class: "bg-brand-200", name: "brand-200" },
    { class: "bg-brand-300", name: "brand-300" },
    { class: "bg-brand-400", name: "brand-400" },
    { class: "bg-brand-500", name: "brand-500" },
    { class: "bg-brand-600", name: "brand-600" },
    { class: "bg-brand-700", name: "brand-700" },
    { class: "bg-brand-800", name: "brand-800" },
    { class: "bg-brand-900", name: "brand-900" },
    { class: "bg-brand-950", name: "brand-950" },
    { class: "bg-brand-foreground", name: "brand-foreground" },
    { class: "bg-success-25", name: "success-25" },
    { class: "bg-success-50", name: "success-50" },
    { class: "bg-success-100", name: "success-100" },
    { class: "bg-success-200", name: "success-200" },
    { class: "bg-success-300", name: "success-300" },
    { class: "bg-success-400", name: "success-400" },
    { class: "bg-success-500", name: "success-500" },
    { class: "bg-success-600", name: "success-600" },
    { class: "bg-success-700", name: "success-700" },
    { class: "bg-success-800", name: "success-800" },
    { class: "bg-success-900", name: "success-900" },
    { class: "bg-success-950", name: "success-950" },
    { class: "bg-blue-25", name: "blue-25" },
    { class: "bg-blue-50", name: "blue-50" },
    { class: "bg-blue-100", name: "blue-100" },
    { class: "bg-blue-200", name: "blue-200" },
    { class: "bg-blue-300", name: "blue-300" },
    { class: "bg-blue-400", name: "blue-400" },
    { class: "bg-blue-500", name: "blue-500" },
    { class: "bg-blue-600", name: "blue-600" },
    { class: "bg-blue-700", name: "blue-700" },
    { class: "bg-blue-800", name: "blue-800" },
    { class: "bg-blue-900", name: "blue-900" },
    { class: "bg-blue-950", name: "blue-950" },
    { class: "bg-error-25", name: "error-25" },
    { class: "bg-error-50", name: "error-50" },
    { class: "bg-error-100", name: "error-100" },
    { class: "bg-error-200", name: "error-200" },
    { class: "bg-error-300", name: "error-300" },
    { class: "bg-error-400", name: "error-400" },
    { class: "bg-error-500", name: "error-500" },
    { class: "bg-error-600", name: "error-600" },
    { class: "bg-error-700", name: "error-700" },
    { class: "bg-error-800", name: "error-800" },
    { class: "bg-error-900", name: "error-900" },
    { class: "bg-error-950", name: "error-950" },
    { class: "bg-muted", name: "muted" },
    { class: "bg-muted-foreground", name: "muted-foreground" },
    { class: "bg-accent", name: "accent" },
    { class: "bg-accent-foreground", name: "accent-foreground" },
    { class: "bg-destructive", name: "destructive" },
    { class: "bg-destructive-foreground", name: "destructive-foreground" },
    { class: "bg-card", name: "card" },
    { class: "bg-card-foreground", name: "card-foreground" },
    { class: "bg-popover", name: "popover" },
    { class: "bg-popover-foreground", name: "popover-foreground" },
    { class: "bg-input", name: "input" },
    { class: "bg-ring", name: "ring" },
    { class: "bg-border", name: "border" },
    { class: "bg-sidebar", name: "sidebar" },
    { class: "bg-sidebar-foreground", name: "sidebar-foreground" },
    { class: "bg-sidebar-border", name: "sidebar-border" },
    { class: "bg-sidebar-ring", name: "sidebar-ring" },
    { class: "bg-sidebar-primary", name: "sidebar-primary" },
    {
      class: "bg-sidebar-primary-foreground",
      name: "sidebar-primary-foreground",
    },
    { class: "bg-sidebar-accent", name: "sidebar-accent" },
    {
      class: "bg-sidebar-accent-foreground",
      name: "sidebar-accent-foreground",
    },
  ];

  return (
    <div className="size-full overflow-y-auto">
      <div className="w-full p-8">
        <div
          className={`
            grid
            md:grid-cols-2
            md:gap-4 lg:grid-cols-10
            xl:grid-cols-11 xl:gap-4
          `}
        >
          <Card className="lg:col-span-4 xl:col-span-4">
            <div
              className={`
                flex flex-row items-center justify-between space-y-0 p-6 pb-2
              `}
            >
              <div className="text-sm font-normal tracking-tight">
                Theme Colors
              </div>
            </div>
            <div
              className={`
                grid grid-cols-2 gap-4 p-6 pt-2
                md:grid-cols-3
                lg:grid-cols-4
              `}
            >
              {colors.map((color) => (
                <div
                  className="flex flex-col items-center gap-2"
                  key={color.name}
                >
                  <div
                    className={`
                      h-8 w-full rounded-md
                      ${color.class}
                      border border-border
                    `}
                  />
                  <span className="text-xs leading-none font-medium">
                    {color.name}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
