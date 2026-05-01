import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { cn } from "@/client/lib/utils";
import { createFileRoute } from "@tanstack/react-router";

import { getDebugRoute } from "./-debug-routes";

export const Route = createFileRoute("/_app/debug/colors")({
  component: RouteComponent,
  head: () => ({
    meta: [
      {
        title: getDebugRoute("colors").title,
      },
    ],
  }),
});

interface ColorToken {
  name: string;
}

const scaleSteps = [
  "25",
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
] as const;

const tokens = (names: string[]) => names.map((name) => ({ name }));

const scaleTokens = (prefix: string) =>
  tokens(scaleSteps.map((step) => `${prefix}-${step}`));

const coreGroups = [
  {
    colors: tokens([
      "background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
    ]),
    title: "Surfaces",
  },
  {
    colors: tokens([
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "destructive",
    ]),
    title: "Actions",
  },
  {
    colors: tokens(["border", "input", "ring"]),
    title: "Chrome",
  },
  {
    colors: tokens([
      "sidebar",
      "sidebar-foreground",
      "sidebar-border",
      "sidebar-ring",
      "sidebar-primary",
      "sidebar-primary-foreground",
      "sidebar-accent",
      "sidebar-accent-foreground",
    ]),
    title: "Sidebar",
  },
] satisfies {
  colors: ColorToken[];
  title: string;
}[];

const scaleGroups = [
  {
    colors: [
      ...tokens(["brand"]),
      ...scaleTokens("brand"),
      ...tokens(["brand-foreground"]),
    ],
    title: "Brand",
  },
  {
    colors: scaleTokens("warning"),
    title: "Warning",
  },
  {
    colors: scaleTokens("success"),
    title: "Success",
  },
  {
    colors: scaleTokens("blue"),
    title: "Blue",
  },
  {
    colors: scaleTokens("error"),
    title: "Error",
  },
  {
    colors: scaleTokens("brown"),
    title: "Brown",
  },
] satisfies {
  colors: ColorToken[];
  title: string;
}[];

function ColorGroup({
  colors,
  isScale = false,
  title,
}: {
  colors: ColorToken[];
  isScale?: boolean;
  title: string;
}) {
  return (
    <Card className="gap-4 overflow-hidden py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto px-5">
        <div
          className={cn(
            "flex gap-3",
            isScale && "min-w-[980px]",
            !isScale && "min-w-max",
          )}
        >
          {colors.map((color) => (
            <ColorSwatch color={color} isScale={isScale} key={color.name} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ColorSwatch({
  color,
  isScale,
}: {
  color: ColorToken;
  isScale: boolean;
}) {
  return (
    <div
      className={cn(
        "flex w-20 shrink-0 flex-col gap-2",
        isScale && "w-auto min-w-0 flex-1 shrink",
      )}
    >
      <div
        className="h-14 rounded-lg border border-border"
        style={{ background: `var(--${color.name})` }}
      />
      <span className="truncate font-mono text-[10px] text-muted-foreground">
        {color.name}
      </span>
    </div>
  );
}

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Theme Colors
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Token palette
          </h1>
        </header>

        <div className="flex flex-col gap-4">
          {scaleGroups.map((group) => (
            <ColorGroup
              colors={group.colors}
              isScale
              key={group.title}
              title={group.title}
            />
          ))}

          <div className="grid gap-4 xl:grid-cols-2">
            {coreGroups.map((group) => (
              <ColorGroup
                colors={group.colors}
                key={group.title}
                title={group.title}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
