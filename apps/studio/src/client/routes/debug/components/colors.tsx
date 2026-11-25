import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { createFileRoute } from "@tanstack/react-router";

import { getDebugPage } from "../-debug-routes";
import { DebugPageScroller } from "../-page-scroller";

export const Route = createFileRoute("/debug/components/colors")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: getDebugPage("colors").label }],
  }),
});

interface ColorToken {
  name: string;
}

const tokens = (names: string[]) => names.map((name) => ({ name }));

const scaleTokens = (prefix: string, steps: readonly string[]) =>
  tokens(steps.map((step) => `${prefix}-${step}`));

/** The full ramp brand and gray are drawn in. */
const FULL_STEPS = [
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

/** The six stops the status and accent ramps carry. */
const SHORT_STEPS = ["50", "100", "300", "500", "700", "900"] as const;

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
      "brand-text",
    ]),
    title: "Actions",
  },
  {
    colors: tokens(["border", "input", "ring", "ground"]),
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
      ...scaleTokens("brand", FULL_STEPS),
      ...tokens(["brand-foreground"]),
    ],
    title: "Brand",
  },
  {
    colors: scaleTokens("gray", FULL_STEPS),
    title: "Gray",
  },
  {
    colors: scaleTokens("error", SHORT_STEPS),
    title: "Error",
  },
  {
    colors: scaleTokens("warning", SHORT_STEPS),
    title: "Warning",
  },
  {
    colors: scaleTokens("success", SHORT_STEPS),
    title: "Success",
  },
  {
    colors: scaleTokens("yellow", SHORT_STEPS),
    title: "Yellow",
  },
  {
    colors: scaleTokens("brown", SHORT_STEPS),
    title: "Brown",
  },
  {
    colors: scaleTokens(
      "dev",
      FULL_STEPS.filter((step) => step !== "25"),
    ),
    title: "Dev (developer-only screens)",
  },
] satisfies {
  colors: ColorToken[];
  title: string;
}[];

function ColorGroup({
  colors,
  title,
}: {
  colors: ColorToken[];
  title: string;
}) {
  return (
    <Card className="gap-4 overflow-hidden py-5">
      <CardHeader className="px-5">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-3">
          {colors.map((color) => (
            <ColorSwatch color={color} key={color.name} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ColorSwatch({ color }: { color: ColorToken }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        className="h-14 rounded-lg border border-border"
        style={{ background: `var(--${color.name})` }}
      />
      <span className="font-mono text-[10px] wrap-anywhere text-muted-foreground">
        {color.name}
      </span>
    </div>
  );
}

function RouteComponent() {
  return (
    <DebugPageScroller>
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-8">
        <p className="text-sm text-muted-foreground">
          Every color the app draws with, by its token name. Look at this page
          in light and dark mode.
        </p>
        <div className="flex flex-col gap-4">
          {scaleGroups.map((group) => (
            <ColorGroup
              colors={group.colors}
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
    </DebugPageScroller>
  );
}
