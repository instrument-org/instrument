export const debugRoutes = [
  {
    description: "Start here and jump into focused debug tools.",
    id: "index",
    label: "Debug Home",
    showCard: false,
    showNav: true,
    title: "Debug Home",
    to: "/debug",
  },
  {
    description: "Theme tokens and color swatches.",
    id: "colors",
    label: "Colors",
    showCard: true,
    showNav: true,
    title: "Debug Colors",
    to: "/debug/colors",
  },
  {
    description: "Preview stream states and message layouts.",
    id: "sessionStream",
    label: "Session Stream",
    showCard: true,
    showNav: true,
    title: "Debug Session Stream",
    to: "/debug/session-stream",
  },
  {
    description: "Trigger RPC error states.",
    id: "errors",
    label: "Errors",
    showCard: true,
    showNav: true,
    title: "Debug Errors",
    to: "/debug/errors",
  },
  {
    description: "Watch agent browser state.",
    id: "browserViews",
    label: "Browser Views",
    showCard: true,
    showNav: true,
    title: "Debug Browser Views",
    to: "/debug/browser-views",
  },
  {
    description: "All AI provider icons at every size.",
    id: "providerIcons",
    label: "Provider Icons",
    showCard: true,
    showNav: true,
    title: "Debug Provider Icons",
    to: "/debug/provider-icons",
  },
  {
    id: "browserView",
    showCard: false,
    showNav: false,
    title: "Debug Browser View",
  },
] as const;

type DebugRouteId = (typeof debugRoutes)[number]["id"];

export function getDebugRoute(id: DebugRouteId) {
  const route = debugRoutes.find((item) => item.id === id);
  if (!route) {
    throw new Error(`Unknown debug route: ${id}`);
  }
  return route;
}
