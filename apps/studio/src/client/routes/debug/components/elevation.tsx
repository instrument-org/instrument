import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/elevation")({
  component: RouteComponent,
  head: () => ({
    meta: [{ title: "Debug elevation" }],
  }),
});

type Level = { className: string; name: string; usedBy?: string };

// Class names are written out whole so Tailwind generates each one.
const ramps: { description: string; levels: Level[]; title: string }[] = [
  {
    description:
      "Each step adds a hairline ring around the shadow, so a card keeps its edge on a background of the same color.",
    levels: [
      {
        className: "shadow-xs",
        name: "xs",
        usedBy: "Checkboxes, switches, file thumbnails",
      },
      {
        className: "shadow-sm",
        name: "sm",
        usedBy: "Inputs, default buttons, cards",
      },
      {
        className: "shadow-md",
        name: "md",
        usedBy: "Onboarding cards, chat tiles",
      },
      {
        className: "shadow-lg",
        name: "lg",
        usedBy: "Dialogs, sheets, the omnibar",
      },
      {
        className: "shadow-xl",
        name: "xl",
        usedBy: "The inbox peek, drop targets",
      },
      { className: "shadow-2xl", name: "2xl", usedBy: "The sign-in modal" },
      { className: "shadow-3xl", name: "3xl" },
    ],
    title: "With a ring",
  },
  {
    description:
      "The same steps without the ring, for something that already has a border or sits on a different color.",
    levels: [
      {
        className: "shadow-xs-soft",
        name: "xs-soft",
        usedBy: "The tab up, the address field",
      },
      {
        className: "shadow-sm-soft",
        name: "sm-soft",
        usedBy: "The message composer",
      },
      {
        className: "shadow-md-soft",
        name: "md-soft",
        usedBy: "Empty-state icons",
      },
      {
        className: "shadow-lg-soft",
        name: "lg-soft",
        usedBy: "The jump-to-latest button",
      },
      {
        className: "shadow-xl-soft",
        name: "xl-soft",
        usedBy: "The floating chat, drafts",
      },
      { className: "shadow-2xl-soft", name: "2xl-soft" },
      { className: "shadow-3xl-soft", name: "3xl-soft" },
    ],
    title: "Soft",
  },
  {
    description:
      "For what floats over whatever is underneath, like menus, popovers, tooltips and toasts. In dark mode the ring is solid, so nothing passing under a menu shows through its edge.",
    levels: [
      {
        className: "shadow-float-sm",
        name: "float-sm",
        usedBy: "Menus, popovers, selects",
      },
      {
        className: "shadow-float-md",
        name: "float-md",
        usedBy: "Tooltips, toasts, the developer panel",
      },
      {
        className: "shadow-float-lg",
        name: "float-lg",
        usedBy: "The mention menu, submenus",
      },
    ],
    title: "Floating",
  },
];

function RouteComponent() {
  return (
    <div className="size-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 p-8">
        <header className="flex flex-col gap-1">
          <p className="text-sm font-medium text-muted-foreground">
            Components
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">Elevation</h1>
          <p className="text-sm text-muted-foreground">
            The shadows the app lifts things off the page with. Each one changes
            with the theme, so look at this page in light and dark mode.
          </p>
        </header>

        {ramps.map((ramp) => (
          <section className="flex flex-col gap-4" key={ramp.title}>
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">{ramp.title}</h2>
              <p className="text-sm text-muted-foreground">
                {ramp.description}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-6 rounded-2xl bg-background p-6 @lg/app-content:grid-cols-4">
              {ramp.levels.map((level) => (
                <div className="flex flex-col gap-2" key={level.name}>
                  <div
                    className={`aspect-4/3 rounded-xl bg-card ${level.className}`}
                  />
                  <p className="font-mono text-xs">{level.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {level.usedBy ?? "Nothing uses this one yet."}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
