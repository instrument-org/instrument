const debugRoutes = [
  {
    description: "Start here and jump into focused debug tools.",
    id: "index",
    label: "Debug home",
    showCard: false,
    showNav: true,
    title: "Debug home",
    to: "/debug",
  },
  {
    description: "Browse UI component previews.",
    id: "components",
    label: "Components",
    showCard: true,
    showNav: true,
    title: "Debug components",
    to: "/debug/components",
  },
  {
    description: "Trigger RPC error states.",
    id: "errors",
    label: "Errors",
    showCard: true,
    showNav: true,
    title: "Debug errors",
    to: "/debug/errors",
  },
  {
    description: "Watch agent browser state.",
    id: "browserViews",
    label: "Browser views",
    showCard: true,
    showNav: true,
    title: "Debug browser views",
    to: "/debug/browser-views",
  },
  {
    description: "Trigger notification states for testing.",
    id: "notifications",
    label: "Notifications",
    showCard: true,
    showNav: true,
    title: "Debug notifications",
    to: "/debug/notifications",
  },
  {
    description: "Plan, trial, usage windows, and the last refusal.",
    id: "billing",
    label: "Billing",
    showCard: true,
    showNav: true,
    title: "Debug billing",
    to: "/debug/billing",
  },
  {
    id: "browserView",
    showCard: false,
    showNav: false,
    title: "Debug browser view",
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
    id: "transcript",
    label: "Transcript",
    to: "/debug/components/transcript",
  },
  {
    id: "question",
    label: "Question card",
    to: "/debug/components/question",
  },
  {
    id: "error-card",
    label: "Error card",
    to: "/debug/components/error-card",
  },
  {
    id: "spinner",
    label: "Spinner",
    to: "/debug/components/spinner",
  },
  {
    id: "typography",
    label: "Typography",
    to: "/debug/components/typography",
  },
  {
    id: "colors",
    label: "Colors",
    to: "/debug/components/colors",
  },
  {
    id: "provider-icons",
    label: "Provider icons",
    to: "/debug/components/provider-icons",
  },
  {
    id: "app-icons",
    label: "App icons",
    to: "/debug/components/app-icons",
  },
  {
    id: "file-icons",
    label: "File icons",
    to: "/debug/components/file-icons",
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
    label: "Form elements",
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

type ComponentPageId = (typeof componentPages)[number]["id"];
type DebugRouteId = (typeof debugRoutes)[number]["id"];
type OnboardingScreenId = (typeof onboardingScreens)[number]["id"];

/**
 * What a tab standing on a debug page is called, read off its path alone so
 * every place that names a tab from its address names this one too. A page
 * this file does not list is still "Debug", never an unnamed tab.
 */
export function debugPageTitle(pathname: string): string {
  const path = pathname.replace(/\/$/, "");
  if (path.startsWith("/debug/browser-view/")) {
    return getDebugRoute("browserView").title;
  }
  const page = [
    ...debugNavigationRoutes,
    ...componentPages,
    ...onboardingScreens,
  ].find((item) => item.to === path);
  return page?.label ?? "Debug";
}

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

export function getOnboardingScreen(id: OnboardingScreenId) {
  const screen = onboardingScreens.find((item) => item.id === id);
  if (!screen) {
    throw new Error(`Unknown onboarding screen: ${id}`);
  }
  return screen;
}
