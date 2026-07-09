const debugRoutes = [
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
    description: "Browse UI component previews.",
    id: "components",
    label: "Components",
    showCard: true,
    showNav: true,
    title: "Debug Components",
    to: "/debug/components",
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
    description: "Trigger notification states for testing.",
    id: "notifications",
    label: "Notifications",
    showCard: true,
    showNav: true,
    title: "Debug Notifications",
    to: "/debug/notifications",
  },
  {
    id: "browserView",
    showCard: false,
    showNav: false,
    title: "Debug Browser View",
  },
] as const;

export const debugNavigationRoutes = debugRoutes.filter(
  (route) => route.showNav && "to" in route,
);

export const debugCardRoutes = debugRoutes.filter(
  (route) => route.showCard && "to" in route,
);

export const componentPages = [
  {
    id: "chat-stream",
    label: "Chat",
    to: "/debug/components/chat-stream",
  },
  {
    id: "data-parts",
    label: "Data Parts",
    to: "/debug/components/data-parts",
  },
  {
    id: "error-card",
    label: "Error Card",
    to: "/debug/components/error-card",
  },
  {
    id: "spinner",
    label: "Spinner",
    to: "/debug/components/spinner",
  },
  {
    id: "colors",
    label: "Colors",
    to: "/debug/components/colors",
  },
  {
    id: "provider-icons",
    label: "Provider Icons",
    to: "/debug/components/provider-icons",
  },
  {
    id: "onboarding",
    label: "Onboarding",
    to: "/debug/components/onboarding",
  },
  {
    id: "alerts",
    label: "Alerts",
    to: "/debug/components/alerts",
  },
  {
    id: "form-elements",
    label: "Form Elements",
    to: "/debug/components/form-elements",
  },
] as const;

export const onboardingScreens = [
  {
    id: "login",
    label: "Log in",
    to: "/debug/components/onboarding/login",
  },
  {
    id: "providers",
    label: "Add provider",
    to: "/debug/components/onboarding/providers",
  },
  {
    id: "complete",
    label: "Complete",
    to: "/debug/components/onboarding/complete",
  },
  {
    id: "theme",
    label: "Pick a theme",
    to: "/debug/components/onboarding/theme",
  },
] as const;

// Flat, searchable list of every navigable debug page, for the command menu.
export const debugPages: { label: string; to: string }[] = [
  ...debugNavigationRoutes.map((route) => ({
    label: route.label,
    to: route.to,
  })),
  ...componentPages.map((page) => ({
    label: `Component: ${page.label}`,
    to: page.to,
  })),
  ...onboardingScreens.map((screen) => ({
    label: `Onboarding: ${screen.label}`,
    to: screen.to,
  })),
];

type ComponentPageId = (typeof componentPages)[number]["id"];
type DebugRouteId = (typeof debugRoutes)[number]["id"];

export function getComponentPage(id: ComponentPageId) {
  const page = componentPages.find((item) => item.id === id);
  if (!page) {
    throw new Error(`Unknown component page: ${id}`);
  }
  return page;
}

export function getDebugRoute(id: DebugRouteId) {
  const route = debugRoutes.find((item) => item.id === id);
  if (!route) {
    throw new Error(`Unknown debug route: ${id}`);
  }
  return route;
}
